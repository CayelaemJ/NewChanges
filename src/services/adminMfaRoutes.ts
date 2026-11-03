import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from './database.js';
import {decodeTotpSecret,decryptTotpSecret,encryptTotpSecret,findTotpStep,generateTotpSecret,makeTotpQrSvgDataUri,makeTotpUri,requireTotpEncryptionKey,totpIsEnabled} from './adminTotp.js';

const MAX_MFA_AGE = 10 * 60 * 1000;
const MAX_CHALLENGE_AGE = 5 * 60 * 1000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const secureCookies = !['0','false','no'].includes(String(process.env.COOKIE_SECURE ?? 'true').toLowerCase());

function mfaConfig() {
  const rpID = process.env.MFA_RP_ID;
  const origin = process.env.MFA_EXPECTED_ORIGIN;
  if (!rpID || !origin) return null;
  try {
    const url = new URL(origin);
    if (url.pathname !== '/' || url.search || url.hash ||
        (url.protocol !== 'https:' && url.hostname !== 'localhost') ||
        !(url.hostname === rpID || url.hostname.endsWith('.' + rpID))) return null;
    return { rpID, origin: url.origin };
  } catch { return null; }
}
async function webauthn() {
  // Dependency installation is mandatory; never accept unverified assertions.
  // @ts-ignore package is installed through a locked, reviewed npm dependency.
  return import('@simplewebauthn/server');
}
async function adminSession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies?.session;
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    reply.code(401).send({error:'Admin session required'}); return null;
  }
  const session = await prisma.session.findUnique({where:{token:digest(token)},include:{user:true}});
  if (!session || session.endedAt || session.revokedAt || session.expiresAt <= new Date() ||
      !session.user.active || !['ADMIN','SUPERADMIN'].includes(session.user.role)) {
    reply.code(403).send({error:'Administrator session unavailable'}); return null;
  }
  return session;
}
export async function hasFreshAdminMfa(req: FastifyRequest, userId: string, method?: 'PASSKEY') {
  const token = req.cookies?.session;
  if (typeof token !== 'string') return false;
  const session = await prisma.session.findUnique({where:{token:digest(token)}});
  if (!session || session.userId !== userId || session.endedAt || session.revokedAt ||
      session.expiresAt <= new Date() || !session.mfaVerifiedAt ||
      (method==='PASSKEY' && session.mfaMethod!=='PASSKEY')) return false;
  const age = Date.now() - session.mfaVerifiedAt.getTime();
  return age >= 0 && age <= MAX_MFA_AGE;
}
function grantHash(code: unknown) {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{43}$/.test(code) ? digest(code) : null;
}
async function hasEnrollmentApproval(session: {id:string;userId:string}) {
  return Boolean(await prisma.adminMfaEnrollmentRequest.findFirst({
    where:{userId:session.userId,sessionId:session.id,
      approvedByOne:{not:null},approvedByTwo:{not:null},
      consumedAt:null,expiresAt:{gt:new Date()}},
    select:{id:true},
  }));
}
async function isAuthorizedToEnroll(
  session: {id:string;userId:string;mfaVerifiedAt:Date|null}, code: unknown
) {
  if (session.mfaVerifiedAt && Date.now() - session.mfaVerifiedAt.getTime() >= 0 &&
      Date.now() - session.mfaVerifiedAt.getTime() <= MAX_MFA_AGE) return true;
  // Server-managed authorization: the session itself is the bearer;
  // the approval record never leaves PostgreSQL or becomes a browser secret.
  if (await hasEnrollmentApproval(session)) return true;
  // Retain legacy, explicitly provisioned one-time grants only for isolated
  // initial-superadmin bootstrap and vetted recovery flows.
  const hash=grantHash(code);
  if (!hash) return false;
  const grant=await prisma.adminMfaEnrollmentGrant.findUnique({where:{codeHash:hash}});
  return Boolean(grant && grant.userId === session.userId && !grant.consumedAt &&
    grant.expiresAt > new Date() && grant.approvedByOne !== grant.approvedByTwo);
}
async function consumeEnrollmentApproval(
  tx:any, session:{id:string;userId:string}, now:Date, grantCode:unknown
) {
  const approved=await tx.adminMfaEnrollmentRequest.findFirst({
    where:{userId:session.userId,sessionId:session.id,
      approvedByOne:{not:null},approvedByTwo:{not:null},
      consumedAt:null,expiresAt:{gt:now}},
    orderBy:{createdAt:'desc'},select:{id:true},
  });
  if (approved) {
    const used=await tx.adminMfaEnrollmentRequest.updateMany({
      where:{id:approved.id,userId:session.userId,sessionId:session.id,
        consumedAt:null,approvedByOne:{not:null},approvedByTwo:{not:null},
        expiresAt:{gt:now}},data:{consumedAt:now},
    });
    if(used.count!==1)throw new Error('Enrollment approval already used');
    return;
  }
  const hash=grantHash(grantCode);
  if(!hash)throw new Error('Enrollment approval required');
  const used=await tx.adminMfaEnrollmentGrant.updateMany({
    where:{userId:session.userId,codeHash:hash,consumedAt:null,
      expiresAt:{gt:now}},data:{consumedAt:now},
  });
  if(used.count!==1)throw new Error('Enrollment grant already used');
}
async function recordChallenge(userId:string,sessionId:string,purpose:string,challenge:string) {
  await prisma.adminMfaChallenge.create({data:{
    userId,sessionId,purpose,challengeHash:digest(challenge),
    expiresAt:new Date(Date.now()+MAX_CHALLENGE_AGE),
  }});
}
async function challengeFor(session:{id:string;userId:string}, purpose:string, challenge: unknown) {
  if (typeof challenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return null;
  const row=await prisma.adminMfaChallenge.findUnique({where:{challengeHash:digest(challenge)}});
  return row && row.userId===session.userId && row.sessionId===session.id &&
    row.purpose===purpose && !row.consumedAt && row.expiresAt>new Date() ? row : null;
}
function newSessionCookie(reply:FastifyReply, token:string, expiresAt:Date) {
  reply.setCookie('session',token,{
    httpOnly:true,sameSite:'lax',secure:secureCookies,path:'/',expires:expiresAt,
  });
}
async function rotateElevatedSession(tx:any,session:any,now:Date,method:'PASSKEY'|'TOTP'='PASSKEY') {
  const closed=await tx.session.updateMany({
    where:{id:session.id,userId:session.userId,endedAt:null,revokedAt:null,expiresAt:{gt:now}},
    data:{endedAt:now,revokedAt:now},
  });
  if (closed.count!==1) throw new Error('Old session no longer active');
  const token=randomBytes(32).toString('hex');
  await tx.session.create({data:{
    userId:session.userId,token:digest(token),expiresAt:session.expiresAt,
    mfaVerifiedAt:now,mfaMethod:method,lastSeenAt:now,ipAddress:session.ipAddress,
    userAgent:session.userAgent,deviceType:session.deviceType,browser:session.browser,
    operatingSystem:session.operatingSystem,country:session.country,region:session.region,
    city:session.city,deviceKey:session.deviceKey,
  }});
  return token;
}
type MfaBody={challenge?:string;response?:any;grantCode?:string};
export function registerAdminMfaRoutes(app:FastifyInstance) {
  app.get('/api/auth/mfa/status',async(req,reply)=>{
    const session=await adminSession(req,reply);if(!session)return;
    const count=await prisma.adminMfaCredential.count({where:{userId:session.userId,revokedAt:null}});
    const verified=await hasFreshAdminMfa(req,session.userId);
    const totp=totpIsEnabled() ? await prisma.adminMfaTotp.findUnique({
      where:{userId:session.userId},select:{enabledAt:true}
    }) : null;
    const passkeyVerified=await hasFreshAdminMfa(req,session.userId,'PASSKEY');
    return {configured:Boolean(mfaConfig()),enrolled:count>0 || Boolean(totp?.enabledAt),
      credentialCount:count,passkeyEnrolled:count>0,totpAvailable:totpIsEnabled(),
      totpEnrolled:Boolean(totp?.enabledAt),verified,
      verificationMethod:session.mfaVerifiedAt && verified ? session.mfaMethod:null,
      canManageRecovery:passkeyVerified && session.user.role==='SUPERADMIN'};
  });
  app.post<{Body:MfaBody}>('/api/auth/mfa/register/options',async(req,reply)=>{
    const session=await adminSession(req,reply);if(!session)return;
    const config=mfaConfig();if(!config)return reply.code(503).send({error:'MFA origin not configured'});
    if(!await isAuthorizedToEnroll(session,req.body?.grantCode))
      return reply.code(403).send({error:'One-time enrollment grant or recent passkey verification required'});
    const existing=await prisma.adminMfaCredential.findMany({where:{userId:session.userId,revokedAt:null}});
    const {generateRegistrationOptions}=await webauthn();
    const options=await generateRegistrationOptions({
      rpName:'The Fixer',rpID:config.rpID,
      userID:new Uint8Array(Buffer.from(session.userId)),
      userName:session.user.email,
      attestationType:'none',supportedAlgorithmIDs:[-7,-257],
      authenticatorSelection:{residentKey:'preferred',userVerification:'required'},
      excludeCredentials:existing.map(x=>({id:x.credentialId,transports:x.transports as any})),
    });
    await recordChallenge(session.userId,session.id,'register',options.challenge);
    return options;
  });
  app.post<{Body:MfaBody}>('/api/auth/mfa/register/verify',async(req,reply)=>{
    const session=await adminSession(req,reply);if(!session)return;
    const config=mfaConfig();if(!config)return reply.code(503).send({error:'MFA origin not configured'});
    const body=req.body??{};
    const challenge=await challengeFor(session,'register',body.challenge);
    if(!challenge || !await isAuthorizedToEnroll(session,body.grantCode))
      return reply.code(403).send({error:'Enrollment approval or challenge expired'});
    let info:any;
    try{
      const {verifyRegistrationResponse}=await webauthn();
      const verified=await verifyRegistrationResponse({
        response:body.response,expectedChallenge:body.challenge!,
        expectedOrigin:config.origin,expectedRPID:config.rpID,
        requireUserVerification:true,supportedAlgorithmIDs:[-7,-257],
      });
      if(!verified.verified || !verified.registrationInfo?.userVerified ||
          !verified.registrationInfo?.credential?.id ||
          !verified.registrationInfo.credential.publicKey) throw new Error('Invalid attestation');
      info=verified.registrationInfo;
    }catch {return reply.code(400).send({error:'Passkey registration failed verification'});}
    const now=new Date();
    try {
      const token=await prisma.$transaction(async tx=>{
        const used=await tx.adminMfaChallenge.updateMany({
          where:{id:challenge.id,userId:session.userId,sessionId:session.id,
            consumedAt:null,expiresAt:{gt:now}},data:{consumedAt:now}});
        if(used.count!==1)throw new Error('Challenge already used');
        const recent=session.mfaVerifiedAt &&
          now.getTime()-session.mfaVerifiedAt.getTime()>=0 &&
          now.getTime()-session.mfaVerifiedAt.getTime()<=MAX_MFA_AGE;
        if(!recent){
          await consumeEnrollmentApproval(tx,session,now,body.grantCode);
        }
        await tx.adminMfaCredential.create({data:{
          userId:session.userId,credentialId:info.credential.id,
          publicKey:Buffer.from(info.credential.publicKey).toString('base64url'),
          signCount:BigInt(info.credential.counter),
          transports:Array.isArray(body.response?.response?.transports)?body.response.response.transports:[],
        }});
        await tx.adminAuditLog.create({data:{
          actorEmail:session.user.email,actorName:session.user.name,
          action:'security.mfa.passkey.enrolled',targetType:'User',targetId:session.userId,
          summary:'Administrator passkey enrollment cryptographically verified',
          riskLevel:'HIGH',flagged:false,
        }});
        return rotateElevatedSession(tx,session,now);
      });
      newSessionCookie(reply,token,session.expiresAt);
      return {ok:true};
    }catch{return reply.code(409).send({error:'Enrollment authorization expired or credential already exists'});}
  });
  app.post('/api/auth/mfa/authenticate/options',async(req,reply)=>{
    const session=await adminSession(req,reply);if(!session)return;
    const config=mfaConfig();if(!config)return reply.code(503).send({error:'MFA origin not configured'});
    const credentials=await prisma.adminMfaCredential.findMany({where:{userId:session.userId,revokedAt:null}});
    if(credentials.length===0)return reply.code(409).send({error:'No passkeys enrolled: ask security administrators for an enrollment grant'});
    const {generateAuthenticationOptions}=await webauthn();
    const options=await generateAuthenticationOptions({
      rpID:config.rpID,userVerification:'required',
      allowCredentials:credentials.map(x=>({id:x.credentialId,transports:x.transports as any})),
    });
    await recordChallenge(session.userId,session.id,'authenticate',options.challenge);
    return options;
  });
  app.post<{Body:MfaBody}>('/api/auth/mfa/authenticate/verify',async(req,reply)=>{
    const session=await adminSession(req,reply);if(!session)return;
    const config=mfaConfig();if(!config)return reply.code(503).send({error:'MFA origin not configured'});
    const challenge=await challengeFor(session,'authenticate',req.body?.challenge);
    if(!challenge)return reply.code(403).send({error:'Challenge missing or expired'});
    const response=req.body?.response;
    if(typeof response?.id!=='string')return reply.code(400).send({error:'Invalid passkey response'});
    const credential=await prisma.adminMfaCredential.findUnique({where:{credentialId:response.id}});
    if(!credential || credential.userId!==session.userId || credential.revokedAt)
      return reply.code(403).send({error:'Passkey not enrolled for this account'});
    const counter=Number(credential.signCount);
    if(!Number.isSafeInteger(counter))return reply.code(403).send({error:'Invalid credential counter'});
    let newCounter:number;
    try{
      const {verifyAuthenticationResponse}=await webauthn();
      const verified=await verifyAuthenticationResponse({
        response,expectedChallenge:req.body.challenge!,
        expectedOrigin:config.origin,expectedRPID:config.rpID,requireUserVerification:true,
        credential:{id:credential.credentialId,
          publicKey:new Uint8Array(Buffer.from(credential.publicKey,'base64url')),
          counter,transports:credential.transports as any},
      });
      if(!verified.verified || !verified.authenticationInfo?.userVerified ||
          !Number.isSafeInteger(verified.authenticationInfo.newCounter))
        throw new Error('Failed assertion verification');
      newCounter=verified.authenticationInfo.newCounter;
      if(newCounter!==0 || counter!==0){
        if(newCounter<=counter)throw new Error('Credential replay counter');
      }
    }catch{return reply.code(403).send({error:'Passkey verification failed'});}
    const now=new Date();
    try{
      const token=await prisma.$transaction(async tx=>{
        const used=await tx.adminMfaChallenge.updateMany({
          where:{id:challenge.id,userId:session.userId,sessionId:session.id,
            consumedAt:null,expiresAt:{gt:now}},data:{consumedAt:now}});
        if(used.count!==1)throw new Error('Challenge already used');
        const bumped=await tx.adminMfaCredential.updateMany({
          where:{credentialId:credential.credentialId,userId:session.userId,
            revokedAt:null,signCount:BigInt(counter)},
          data:{signCount:BigInt(newCounter),lastUsedAt:now},
        });
        if(bumped.count!==1)throw new Error('Credential rotated');
        await tx.adminAuditLog.create({data:{
          actorEmail:session.user.email,actorName:session.user.name,
          action:'security.mfa.passkey.verified',targetType:'User',targetId:session.userId,
          summary:'Administrator passkey verification succeeded',
          riskLevel:'NORMAL',flagged:false,
        }});
        return rotateElevatedSession(tx,session,now);
      });
      newSessionCookie(reply,token,session.expiresAt);
      return {ok:true};
    }catch{return reply.code(409).send({error:'Passkey assertion already consumed'});}
  });

  // RFC 6238: authenticator apps (Google / Microsoft / others) use the same
  // standard otpauth URI and 30-second, six-digit TOTP flow. The QR is generated
  // server-side; no code or secret is sent to an image service.
  app.post<{Body:{grantCode?:string}}>('/api/auth/mfa/totp/setup',async(req,reply)=>{
    const session=await adminSession(req,reply);if(!session)return;
    if(!totpIsEnabled())return reply.code(404).send({error:'Authenticator app setup is unavailable'});
    const key=requireTotpEncryptionKey();
    const existing=await prisma.adminMfaTotp.findUnique({where:{userId:session.userId}});
    if(existing?.enabledAt) return reply.code(409).send({error:'Authenticator already enrolled; verified factor recovery required to replace it'});
    if(!await isAuthorizedToEnroll(session,req.body?.grantCode))
      return reply.code(403).send({error:'A one-time enrollment grant or recently verified factor is required'});
    const secret=generateTotpSecret();
    const encrypted=encryptTotpSecret(secret,key);
    const expiresAt=new Date(Date.now()+10*60_000);
    await prisma.adminMfaTotp.upsert({
      where:{userId:session.userId},
      create:{userId:session.userId,pendingCiphertext:encrypted,pendingExpiresAt:expiresAt},
      update:{pendingCiphertext:encrypted,pendingExpiresAt:expiresAt},
    });
    const uri=makeTotpUri(session.user.email,secret);
    const qr=await makeTotpQrSvgDataUri(uri);
    reply.header('Cache-Control','no-store').header('Pragma','no-cache');
    return {ok:true,qrDataUri:qr,manualKey:secret,expiresAt:expiresAt.toISOString(),
      message:'Scan this QR with your authenticator app, then enter the displayed six-digit code'};
  });
  app.post<{Body:{grantCode?:string;code?:string}}>('/api/auth/mfa/totp/confirm',async(req,reply)=>{
    const session=await adminSession(req,reply);if(!session)return;
    if(!totpIsEnabled())return reply.code(404).send({error:'Authenticator app setup is unavailable'});
    const row=await prisma.adminMfaTotp.findUnique({where:{userId:session.userId}});
    const now=new Date();
    if(!row?.pendingCiphertext || !row.pendingExpiresAt || row.pendingExpiresAt<=now || row.enabledAt)
      return reply.code(409).send({error:'Authenticator setup expired; start again'});
    if(!await isAuthorizedToEnroll(session,req.body?.grantCode))
      return reply.code(403).send({error:'Approved enrollment grant or verified factor required'});
    let step:bigint|null=null;
    try{
      step=findTotpStep(decryptTotpSecret(row.pendingCiphertext,requireTotpEncryptionKey()),
        req.body?.code,now.getTime());
    }catch{return reply.code(503).send({error:'Authenticator setup cannot be verified'});}
    if(step===null)return reply.code(400).send({error:'Invalid or expired authenticator code'});
    try{
      const token=await prisma.$transaction(async tx=>{
        const claimed=await tx.adminMfaTotp.updateMany({
          where:{userId:session.userId,pendingCiphertext:row.pendingCiphertext,
            pendingExpiresAt:{gt:now},enabledAt:null},
          data:{secretCiphertext:row.pendingCiphertext,pendingCiphertext:null,
            pendingExpiresAt:null,enabledAt:now,lastUsedStep:step,
            failedAttempts:0,lastFailedAt:null,lockedUntil:null},
        });
        if(claimed.count!==1)throw new Error('TOTP setup already consumed');
        const alreadyVerified=session.mfaVerifiedAt &&
          now.getTime()-session.mfaVerifiedAt.getTime()>=0 &&
          now.getTime()-session.mfaVerifiedAt.getTime()<=MAX_MFA_AGE;
        if(!alreadyVerified){
          await consumeEnrollmentApproval(tx,session,now,req.body?.grantCode);
        }
        await tx.adminAuditLog.create({data:{
          actorEmail:session.user.email,actorName:session.user.name,
          action:'security.mfa.totp.enrolled',targetType:'User',targetId:session.userId,
          summary:'Administrator authenticator app enrolled with verified TOTP code',
          riskLevel:'HIGH',flagged:false,
        }});
        return rotateElevatedSession(tx,session,now,'TOTP');
      });
      newSessionCookie(reply,token,session.expiresAt);
      reply.header('Cache-Control','no-store');
      return {ok:true};
    }catch{return reply.code(409).send({error:'Authenticator setup or enrollment grant already used'});}
  });
  app.post<{Body:{code?:string}}>('/api/auth/mfa/totp/verify',async(req,reply)=>{
    const session=await adminSession(req,reply);if(!session)return;
    if(!totpIsEnabled())return reply.code(404).send({error:'Authenticator app verification unavailable'});
    const row=await prisma.adminMfaTotp.findUnique({where:{userId:session.userId}});
    const now=new Date();
    if(!row?.enabledAt || !row.secretCiphertext)
      return reply.code(409).send({error:'No authenticator app enrolled'});
    if(row.lockedUntil && row.lockedUntil>now)
      return reply.code(429).header('Retry-After',Math.ceil((row.lockedUntil.getTime()-now.getTime())/1000))
        .send({error:'Too many attempts; authenticator verification temporarily locked'});
    let step:bigint|null=null;
    try{
      step=findTotpStep(decryptTotpSecret(row.secretCiphertext,requireTotpEncryptionKey()),
        req.body?.code,now.getTime(),row.lastUsedStep);
    }catch{return reply.code(503).send({error:'Authenticator verification unavailable'});}
    if(step===null){
      const recent=row.lastFailedAt && now.getTime()-row.lastFailedAt.getTime()<10*60_000;
      const attempts=recent?row.failedAttempts+1:1;
      await prisma.adminMfaTotp.updateMany({
        where:{id:row.id,lastUsedStep:row.lastUsedStep,
          failedAttempts:row.failedAttempts},
        data:{failedAttempts:attempts,lastFailedAt:now,
          lockedUntil:attempts>=5?new Date(now.getTime()+10*60_000):null},
      });
      return reply.code(403).send({error:'Incorrect, expired or already-used authenticator code'});
    }
    try{
      const token=await prisma.$transaction(async tx=>{
        const updated=await tx.adminMfaTotp.updateMany({
          where:{id:row.id,userId:session.userId,enabledAt:{not:null},
            OR:[{lastUsedStep:null},{lastUsedStep:{lt:step}}]},
          data:{lastUsedStep:step,failedAttempts:0,lastFailedAt:null,lockedUntil:null},
        });
        if(updated.count!==1)throw new Error('TOTP time step replay');
        await tx.adminAuditLog.create({data:{
          actorEmail:session.user.email,actorName:session.user.name,
          action:'security.mfa.totp.verified',targetType:'User',targetId:session.userId,
          summary:'Administrator authenticator code verified without replay',
          riskLevel:'NORMAL',flagged:false,
        }});
        return rotateElevatedSession(tx,session,now,'TOTP');
      });
      newSessionCookie(reply,token,session.expiresAt);
      return {ok:true};
    }catch(err){
      // Never log the TOTP code, secret, body or raw Prisma error. A validation
      // or database failure must not masquerade as a reused authenticator code.
      if(err instanceof Error && err.message==='TOTP time step replay')
        return reply.code(409).send({error:'Authenticator code was already used; wait for a new code'});
      req.log.error({code:typeof (err as {code?:unknown})?.code==='string'?
        (err as {code:string}).code:'TOTP_TRANSACTION_FAILED'},'TOTP verification transaction failed');
      return reply.code(503).send({error:'Authenticator verification temporarily unavailable; try again'});
    }
  });

  // Password recovery alone NEVER bypasses passkey MFA. This two-person
  // recovery flow works only if two distinct superadmins already have
  // independently verified passkey sessions. No public or password-only bypass.
  app.post<{Body:{targetUserId?:string}}>('/api/admin/mfa/recovery/request',async(req,reply)=>{
    const session=await adminSession(req,reply);if(!session)return;
    if(session.user.role!=='SUPERADMIN' || !await hasFreshAdminMfa(req,session.userId,'PASSKEY'))
      return reply.code(403).send({error:'Verified superadministrator required'});
    const targetUserId=req.body?.targetUserId;
    if(typeof targetUserId!=='string' || !targetUserId ||
        targetUserId.length>128 || targetUserId===session.userId)
      return reply.code(400).send({error:'An eligible different administrator is required'});
    const target=await prisma.user.findUnique({where:{id:targetUserId},select:{id:true,role:true,active:true}});
    if(!target || !target.active || !['ADMIN','SUPERADMIN'].includes(target.role))
      return reply.code(404).send({error:'Eligible administrator not found'});
    const now=new Date();
    const pending=await prisma.adminMfaRecoveryRequest.count({
      where:{targetUserId,expiresAt:{gt:now},fulfilledAt:null},
    });
    if(pending) return reply.code(409).send({error:'A recovery approval is already pending'});
    const expiresAt=new Date(now.getTime()+15*60_000);
    const id=await prisma.$transaction(async tx=>{
      const request=await tx.adminMfaRecoveryRequest.create({
        data:{targetUserId,requestedById:session.userId,expiresAt},
      });
      await tx.adminAuditLog.create({data:{
        actorEmail:session.user.email,actorName:session.user.name,
        action:'security.mfa.recovery.requested',targetType:'User',targetId:targetUserId,
        summary:'MFA recovery requested; a distinct passkey-verified superadministrator must approve',
        detail:{requestId:request.id,expiresAt:expiresAt.toISOString()},
        riskLevel:'HIGH',flagged:true,
      }});
      return request.id;
    });
    return {ok:true,requestId:id,expiresAt:expiresAt.toISOString(),
      next:'A different passkey-verified superadministrator must approve this request'};
  });

  app.post<{Params:{id:string}}>('/api/admin/mfa/recovery/:id/approve',async(req,reply)=>{
    const session=await adminSession(req,reply);if(!session)return;
    if(session.user.role!=='SUPERADMIN' || !await hasFreshAdminMfa(req,session.userId,'PASSKEY'))
      return reply.code(403).send({error:'Verified superadministrator required'});
    const id=req.params.id;
    if(!id || id.length>128) return reply.code(400).send({error:'Invalid recovery request'});
    const request=await prisma.adminMfaRecoveryRequest.findUnique({where:{id}});
    const now=new Date();
    if(!request || request.fulfilledAt || request.approvedById || request.expiresAt<=now ||
        request.requestedById===session.userId || request.targetUserId===session.userId)
      return reply.code(409).send({error:'Recovery request unavailable or independent approval required'});
    const [requester,target]=await Promise.all([
      prisma.user.findUnique({where:{id:request.requestedById},select:{id:true,active:true,role:true}}),
      prisma.user.findUnique({where:{id:request.targetUserId},select:{id:true,active:true,role:true}}),
    ]);
    if(!requester?.active || requester.role!=='SUPERADMIN' ||
        !target?.active || !['ADMIN','SUPERADMIN'].includes(target.role) ||
        target.id===requester.id)
      return reply.code(403).send({error:'Recovery identities no longer eligible'});

    // The raw code is returned ONCE to the second approver, never recorded or
    // emailed automatically. Out-of-band, independently verified delivery
    // to the target administrator is required.
    const grantCode=randomBytes(32).toString('base64url');
    const grantExpiresAt=new Date(now.getTime()+10*60_000);
    try{
      await prisma.$transaction(async tx=>{
        const claimed=await tx.adminMfaRecoveryRequest.updateMany({
          where:{id,requestedById:request.requestedById,
            targetUserId:request.targetUserId,approvedById:null,fulfilledAt:null,
            expiresAt:{gt:now}},
          data:{approvedById:session.userId,fulfilledAt:now},
        });
        if(claimed.count!==1)throw new Error('Already approved');
        await tx.adminMfaEnrollmentGrant.updateMany({
          where:{userId:target.id,consumedAt:null},data:{consumedAt:now},
        });
        await tx.adminMfaCredential.updateMany({
          where:{userId:target.id,revokedAt:null},data:{revokedAt:now},
        });
        await tx.adminMfaTotp.deleteMany({where:{userId:target.id}});
        await tx.session.updateMany({
          where:{userId:target.id,endedAt:null},data:{endedAt:now,revokedAt:now},
        });
        await tx.adminMfaChallenge.deleteMany({where:{userId:target.id}});
        await tx.adminMfaEnrollmentGrant.create({data:{
          userId:target.id,codeHash:digest(grantCode),expiresAt:grantExpiresAt,
          approvedByOne:request.requestedById,approvedByTwo:session.userId,
        }});
        await tx.adminAuditLog.create({data:{
          actorEmail:session.user.email,actorName:session.user.name,
          action:'security.mfa.recovery.approved',targetType:'User',targetId:target.id,
          summary:'Two verified superadministrators authorised MFA recovery; existing sessions and passkeys revoked',
          detail:{requestId:id,firstApproverId:request.requestedById,
            secondApproverId:session.userId,grantExpiry:grantExpiresAt.toISOString()},
          riskLevel:'HIGH',flagged:true,
        }});
      });
    }catch{
      return reply.code(409).send({error:'Recovery approval expired or was already completed'});
    }
    reply.header('Cache-Control','no-store');
    return {ok:true,grantCode,expiresAt:grantExpiresAt.toISOString(),
      instruction:'Deliver this one-time code to the verified target using a separate secure channel; never publish it'};
  });
}
