import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { prisma } from './database.js';
import {decodeTotpSecret,decryptTotpSecret,encryptTotpSecret,findTotpStep,generateTotpSecret,makeTotpQrSvgDataUri,makeTotpUri,requireTotpEncryptionKey,totpIsEnabled} from './adminTotp.js';
import { SESSION_IDLE_TIMEOUT_MS, verifyPassword } from './authService.js';

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
async function mfaSession(req: FastifyRequest, reply: FastifyReply) {
  const token = req.cookies?.session;
  if (typeof token !== 'string' || token.length < 32 || token.length > 256) {
    reply.code(401).send({error:'Signed-in account required'}); return null;
  }
  const session = await prisma.session.findUnique({where:{token:digest(token)},include:{user:true}});
  const now=new Date();
  if (!session || session.endedAt || session.revokedAt || session.expiresAt <= now ||
      !session.user.active) {
    reply.code(403).send({error:'Account session unavailable'}); return null;
  }
  if (now.getTime()-session.lastSeenAt.getTime()>SESSION_IDLE_TIMEOUT_MS) {
    await prisma.session.updateMany({
      where:{id:session.id,endedAt:null},data:{endedAt:now},
    });
    reply.code(401).send({error:'Session expired after inactivity; sign in again'}); return null;
  }
  if (now.getTime()-session.lastSeenAt.getTime()>60_000) {
    await prisma.session.updateMany({
      where:{id:session.id,endedAt:null,revokedAt:null},data:{lastSeenAt:now},
    });
  }
  return session;
}
async function adminSession(req: FastifyRequest, reply: FastifyReply) {
  const session=await mfaSession(req,reply);
  if (!session) return null;
  if (!['ADMIN','SUPERADMIN'].includes(session.user.role)) {
    reply.code(403).send({error:'Administrator session required'}); return null;
  }
  return session;
}
// Only an active, individually-issued recovery key satisfies the onboarding gate.
export async function hasIssuedAdminRecoveryKey(userId:string){
  const key=await prisma.adminMfaRecoveryCode.findUnique({
    where:{userId},select:{usedAt:true},
  });
  return Boolean(key && !key.usedAt);
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
// Normal signed-in access trusts the MFA proof for the life of its active
// session. Sensitive admin operations still use hasFreshAdminMfa (10 minutes).
export async function hasVerifiedMfaSession(req: FastifyRequest, userId: string) {
  const token=req.cookies?.session;
  if(typeof token!=='string')return false;
  const session=await prisma.session.findUnique({where:{token:digest(token)}});
  return Boolean(session && session.userId===userId && !session.endedAt &&
    !session.revokedAt && session.expiresAt>new Date() && session.mfaVerifiedAt);
}
function grantHash(code: unknown) {
  return typeof code === 'string' && /^[A-Za-z0-9_-]{43}$/.test(code) ? digest(code) : null;
}
async function hasEnrollmentApproval(session: {id:string;userId:string}) {
  const request=await prisma.adminMfaEnrollmentRequest.findFirst({
    where:{userId:session.userId,sessionId:session.id,
      approvedByOne:{not:null},approvedByTwo:{not:null},
      consumedAt:null,expiresAt:{gt:new Date()}},
    select:{approvedByOne:true,approvedByTwo:true},
  });
  return Boolean(request && request.approvedByOne!==request.approvedByTwo);
}
async function isAuthorizedToEnroll(
  session: {id:string;userId:string;mfaVerifiedAt:Date|null;user:{role:string;passwordHash:string|null}},
  proof: {grantCode?:unknown;password?:unknown}
) {
  if (session.mfaVerifiedAt) return true;
  const password=proof?.password;
  const passwordValid=typeof password==='string' && password.length<=256 &&
    !!session.user.passwordHash && verifyPassword(password,session.user.passwordHash);
  if (!['ADMIN','SUPERADMIN'].includes(session.user.role)) return passwordValid;
  const [passkeyCount,totp]=await Promise.all([
    prisma.adminMfaCredential.count({where:{userId:session.userId,revokedAt:null}}),
    prisma.adminMfaTotp.findUnique({where:{userId:session.userId},select:{enabledAt:true}}),
  ]);
  // Existing accounts with no MFA factor can self-enroll after confirming
  // their current password. A second superadmin is not required for initial
  // rollout; already-enrolled administrators still need MFA or approved recovery.
  if (passkeyCount===0 && !totp?.enabledAt && passwordValid) return true;
  // Approved grants remain available for identity-verified administrator recovery.
  if (await hasEnrollmentApproval(session)) return true;
  const hash=grantHash(proof?.grantCode);
  if (!hash) return false;
  const grant=await prisma.adminMfaEnrollmentGrant.findUnique({where:{codeHash:hash}});
  return Boolean(grant && grant.userId === session.userId && !grant.consumedAt &&
    grant.expiresAt > new Date() && grant.approvedByOne !== grant.approvedByTwo);
}
async function consumeEnrollmentApproval(
  tx:any, session:{id:string;userId:string}, now:Date, grantCode:unknown,
  required:boolean
) {
  const approved=await tx.adminMfaEnrollmentRequest.findFirst({
    where:{userId:session.userId,sessionId:session.id,
      approvedByOne:{not:null},approvedByTwo:{not:null},
      consumedAt:null,expiresAt:{gt:now}},
    orderBy:{createdAt:'desc'},select:{id:true,approvedByOne:true,approvedByTwo:true},
  });
  if (approved && approved.approvedByOne!==approved.approvedByTwo) {
    const used=await tx.adminMfaEnrollmentRequest.updateMany({
      where:{id:approved.id,userId:session.userId,sessionId:session.id,
        consumedAt:null,approvedByOne:{not:null},approvedByTwo:{not:null},
        expiresAt:{gt:now}},data:{consumedAt:now},
    });
    if(used.count!==1)throw new Error('Enrollment approval already used');
    return;
  }
  const hash=grantHash(grantCode);
  if(hash){
    const used=await tx.adminMfaEnrollmentGrant.updateMany({
      where:{userId:session.userId,codeHash:hash,consumedAt:null,
        expiresAt:{gt:now}},data:{consumedAt:now},
    });
    if(used.count===1)return;
    throw new Error('Enrollment grant already used');
  }
  if(required)throw new Error('Enrollment approval required');
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
// A user's emergency recovery key is not the TOTP encryption key and is
// never stored in plaintext. Re-issuance replaces the prior unused key.
async function issueRecoveryKey(tx:any,userId:string){
  const previous=await tx.adminMfaRecoveryCode.findUnique({
    where:{userId},select:{id:true,usedAt:true},
  });
  if(previous && !previous.usedAt)return null;
  const key=randomBytes(32).toString('base64url');
  if(previous){
    await tx.adminMfaRecoveryCode.update({
      where:{id:previous.id},
      data:{codeHash:digest(key),usedAt:null,failedAttempts:0,lockedUntil:null,createdAt:new Date()},
    });
  }else{
    await tx.adminMfaRecoveryCode.create({data:{userId,codeHash:digest(key)}});
  }
  return key;
}
type MfaBody={challenge?:string;response?:any;grantCode?:string;password?:string};
export function registerAdminMfaRoutes(app:FastifyInstance) {
  // Retain operator-verified enrollment approvals for explicitly requested
  // exceptional cases. Normal first-time enrollment uses the account password.
  app.post('/api/auth/mfa/enrollment/request',async(req,reply)=>{
    const session=await adminSession(req,reply);if(!session)return;
    const factors=await Promise.all([
      prisma.adminMfaCredential.count({where:{userId:session.userId,revokedAt:null}}),
      prisma.adminMfaTotp.findUnique({where:{userId:session.userId},select:{enabledAt:true}}),
    ]);
    if(factors[0] || factors[1]?.enabledAt)
      return reply.code(409).send({error:'MFA already enrolled; verify an existing factor or use approved recovery'});
    const now=new Date();
    const current=await prisma.adminMfaEnrollmentRequest.findFirst({
      where:{userId:session.userId,sessionId:session.id,consumedAt:null,expiresAt:{gt:now}},
      orderBy:{createdAt:'desc'},
    });
    if(current) return {ok:true,requestId:current.id,
      approved:Boolean(current.approvedByOne && current.approvedByTwo && current.approvedByOne!==current.approvedByTwo),
      expiresAt:current.expiresAt.toISOString()};
    const request=await prisma.$transaction(async tx=>{
      const row=await tx.adminMfaEnrollmentRequest.create({
        data:{userId:session.userId,sessionId:session.id,
          expiresAt:new Date(now.getTime()+30*60_000)},
      });
      await tx.adminAuditLog.create({data:{
        actorEmail:session.user.email,actorName:session.user.name,
        action:'security.mfa.enrollment.requested',targetType:'User',targetId:session.userId,
        summary:'Identity-verified first-time MFA enrollment requested',
        detail:{requestId:row.id},riskLevel:'HIGH',flagged:true,
      }});
      return row;
    });
    return {ok:true,requestId:request.id,approved:false,expiresAt:request.expiresAt.toISOString()};
  });

  app.get('/api/auth/mfa/enrollment/status',async(req,reply)=>{
    const session=await adminSession(req,reply);if(!session)return;
    const current=await prisma.adminMfaEnrollmentRequest.findFirst({
      where:{userId:session.userId,sessionId:session.id,
        consumedAt:null,expiresAt:{gt:new Date()}},
      orderBy:{createdAt:'desc'},select:{id:true,expiresAt:true,approvedByOne:true,approvedByTwo:true},
    });
    reply.header('Cache-Control','no-store');
    return {ok:true,requestId:current?.id??null,
      approved:Boolean(current?.approvedByOne && current?.approvedByTwo &&
        current.approvedByOne!==current.approvedByTwo),
      expiresAt:current?.expiresAt.toISOString()??null};
  });

  app.post<{Params:{id:string};Body:{identityConfirmed?:boolean}}>(
    '/api/admin/mfa/enrollment/:id/approve',async(req,reply)=>{
    const session=await adminSession(req,reply);if(!session)return;
    if(session.user.role!=='SUPERADMIN' ||
      !await hasFreshAdminMfa(req,session.userId,'PASSKEY'))
      return reply.code(403).send({error:'Fresh passkey-verified superadministrator required'});
    if(req.body?.identityConfirmed!==true)
      return reply.code(400).send({error:"Independently verify the requester's identity before approval"});
    const id=req.params.id;
    if(typeof id!=='string'||id.length>128||id.length<8)
      return reply.code(400).send({error:'Invalid enrollment request'});
    const request=await prisma.adminMfaEnrollmentRequest.findUnique({where:{id}});
    const now=new Date();
    if(!request || request.expiresAt<=now || request.consumedAt ||
      request.userId===session.userId ||
      request.approvedByOne===session.userId || request.approvedByTwo)
      return reply.code(409).send({error:'Request expired, completed or independent approval required'});
    const [target,targetSession,passkeys,totp]=await Promise.all([
      prisma.user.findUnique({where:{id:request.userId},select:{active:true,role:true,email:true}}),
      prisma.session.findUnique({where:{id:request.sessionId},
        select:{userId:true,endedAt:true,revokedAt:true,expiresAt:true}}),
      prisma.adminMfaCredential.count({where:{userId:request.userId,revokedAt:null}}),
      prisma.adminMfaTotp.findUnique({where:{userId:request.userId},select:{enabledAt:true}}),
    ]);
    if(!target?.active || !['ADMIN','SUPERADMIN'].includes(target.role) ||
       !targetSession || targetSession.userId!==request.userId ||
       targetSession.endedAt || targetSession.revokedAt || targetSession.expiresAt<=now ||
       passkeys>0 || Boolean(totp?.enabledAt))
      return reply.code(409).send({error:'Requester no longer eligible for first-time setup'});
    if(request.approvedByOne){
      const firstApprover=await prisma.user.findUnique({
        where:{id:request.approvedByOne},select:{active:true,role:true},
      });
      if(!firstApprover?.active || firstApprover.role!=='SUPERADMIN')
        return reply.code(409).send({error:'First approver is no longer authorized'});
    }
    try{
      const stage=request.approvedByOne ? 2 : 1;
      const updated=await prisma.$transaction(async tx=>{
        const claimed=await tx.adminMfaEnrollmentRequest.updateMany({
          where:{id,userId:request.userId,sessionId:request.sessionId,
            expiresAt:{gt:now},consumedAt:null,approvedByOne:request.approvedByOne,
            approvedByTwo:null},
          data:stage===1?{approvedByOne:session.userId}:{approvedByTwo:session.userId},
        });
        if(claimed.count!==1)throw new Error('Enrollment approval conflict');
        await tx.adminAuditLog.create({data:{
          actorEmail:session.user.email,actorName:session.user.name,
          action:stage===1?'security.mfa.enrollment.first_approval':'security.mfa.enrollment.final_approval',
          targetType:'User',targetId:request.userId,
          summary:'Independent passkey-verified MFA enrollment approval',
          detail:{requestId:id,stage},riskLevel:'HIGH',flagged:true,
        }});
        return stage;
      });
      reply.header('Cache-Control','no-store');
      return {ok:true,approved:updated===2,approvals:updated,
        instruction:updated===2?'User may now enroll MFA in the requesting session':
          'A DIFFERENT passkey-verified superadministrator must independently approve'};
    }catch{return reply.code(409).send({error:'Request already approved or no longer eligible'});}
  });

  app.get('/api/auth/mfa/status',async(req,reply)=>{
    const session=await mfaSession(req,reply);if(!session)return;
    const count=await prisma.adminMfaCredential.count({where:{userId:session.userId,revokedAt:null}});
    const verified=await hasVerifiedMfaSession(req,session.userId);
    const totp=totpIsEnabled() ? await prisma.adminMfaTotp.findUnique({
      where:{userId:session.userId},select:{enabledAt:true}
    }) : null;
    const passkeyVerified=await hasFreshAdminMfa(req,session.userId,'PASSKEY');
    const recoveryKey=await prisma.adminMfaRecoveryCode.findUnique({where:{userId:session.userId},select:{usedAt:true}});
    return {configured:Boolean(mfaConfig()),enrolled:count>0 || Boolean(totp?.enabledAt),
      credentialCount:count,passkeyEnrolled:count>0,totpAvailable:totpIsEnabled(),
      totpEnrolled:Boolean(totp?.enabledAt),verified,hasRecoveryKey:Boolean(recoveryKey && !recoveryKey.usedAt),
      verificationMethod:session.mfaVerifiedAt && verified ? session.mfaMethod:null,
      canManageRecovery:passkeyVerified && session.user.role==='SUPERADMIN',
      isAdministrator:['ADMIN','SUPERADMIN'].includes(session.user.role),
      accountName:session.user.name};
  });
  // Previously enrolled users may obtain their first recovery key during
  // an active MFA-verified session. Existing keys are never retrievable here.
  app.post('/api/auth/mfa/recovery-key/issue',async(req,reply)=>{
    const session=await mfaSession(req,reply);if(!session)return;
    if(!await hasVerifiedMfaSession(req,session.userId))
      return reply.code(403).send({error:'Verify MFA before generating a recovery key'});
    const enrolled=await Promise.all([
      prisma.adminMfaCredential.count({where:{userId:session.userId,revokedAt:null}}),
      prisma.adminMfaTotp.findUnique({where:{userId:session.userId},select:{enabledAt:true}}),
    ]);
    if(!enrolled[0] && !enrolled[1]?.enabledAt)
      return reply.code(409).send({error:'Enroll MFA first'});
    const existing=await prisma.adminMfaRecoveryCode.findUnique({where:{userId:session.userId},select:{id:true,usedAt:true}});
    if(existing && !existing.usedAt)return reply.code(409).send({error:'A recovery key is already issued; it cannot be viewed again'});
    try{
      const key=await prisma.$transaction(async tx=>{
        const issued=await issueRecoveryKey(tx,session.userId);
        if(!issued)throw new Error('Already issued');
        await tx.adminAuditLog.create({data:{
          actorEmail:session.user.email,actorName:session.user.name,
          action:'security.mfa.recovery_key.issued',targetType:'User',targetId:session.userId,
          summary:'One-time-display MFA recovery key issued after fresh factor verification',
          riskLevel:'HIGH',flagged:false,
        }});
        return issued;
      });
      reply.header('Cache-Control','no-store').header('Pragma','no-cache');
      return {ok:true,recoveryKey:key};
    }catch{return reply.code(409).send({error:'Recovery key already issued'});}
  });
  // A regular account can recover its own factors only with both its current
  // password and the one-time recovery key. Administrator recovery continues
  // through the separately approved two-superadmin process below.
  app.post<{Body:{password?:string;recoveryKey?:string} }>(
    '/api/auth/mfa/recovery/self',async(req,reply)=>{
    const session=await mfaSession(req,reply);if(!session)return;
    if(['ADMIN','SUPERADMIN'].includes(session.user.role))
      return reply.code(403).send({error:'Administrator accounts use the approved security recovery process'});
    const password=req.body?.password;
    const recoveryKey=req.body?.recoveryKey;
    const row=await prisma.adminMfaRecoveryCode.findUnique({where:{userId:session.userId}});
    const now=new Date();
    if(row?.lockedUntil && row.lockedUntil>now)
      return reply.code(429).header('Retry-After',Math.ceil((row.lockedUntil.getTime()-now.getTime())/1000))
        .send({error:'Account recovery is temporarily locked'});
    const passwordValid=typeof password==='string' && password.length<=256 &&
      !!session.user.passwordHash && verifyPassword(password,session.user.passwordHash);
    const keyDigest=typeof recoveryKey==='string' && /^[A-Za-z0-9_-]{43}$/.test(recoveryKey)
      ?digest(recoveryKey):'';
    const keyValid=!!row && !row.usedAt && keyDigest.length===row.codeHash.length &&
      timingSafeEqual(Buffer.from(keyDigest),Buffer.from(row.codeHash));
    if(!passwordValid || !keyValid){
      if(row && !row.usedAt){
        const attempts=row.failedAttempts+1;
        await prisma.adminMfaRecoveryCode.updateMany({
          where:{id:row.id,usedAt:null,failedAttempts:row.failedAttempts},
          data:{failedAttempts:attempts,lockedUntil:attempts>=5?new Date(now.getTime()+15*60_000):null},
        });
      }
      return reply.code(403).send({error:'Password or recovery key is invalid'});
    }
    try{
      await prisma.$transaction(async tx=>{
        const consumed=await tx.adminMfaRecoveryCode.updateMany({
          where:{id:row.id,userId:session.userId,codeHash:row.codeHash,usedAt:null,
            failedAttempts:row.failedAttempts,
            OR:[{lockedUntil:null},{lockedUntil:{lte:now}}]},
          data:{usedAt:now,failedAttempts:0,lockedUntil:null},
        });
        if(consumed.count!==1)throw new Error('Recovery key already consumed');
        await tx.adminMfaCredential.updateMany({where:{userId:session.userId,revokedAt:null},data:{revokedAt:now}});
        await tx.adminMfaTotp.deleteMany({where:{userId:session.userId}});
        await tx.adminMfaChallenge.updateMany({where:{userId:session.userId,consumedAt:null},data:{consumedAt:now}});
        await tx.session.updateMany({where:{userId:session.userId,endedAt:null},
          data:{endedAt:now,revokedAt:now,revokedBy:'self-service MFA recovery'}});
        await tx.adminAuditLog.create({data:{
          actorEmail:session.user.email,actorName:session.user.name,
          action:'security.mfa.self_recovery',targetType:'User',targetId:session.userId,
          summary:'Account owner used password and one-time recovery key to revoke MFA factors and sessions',
          riskLevel:'HIGH',flagged:true,
        }});
      });
      reply.clearCookie('session',{path:'/',secure:secureCookies,httpOnly:true,sameSite:'lax'});
      reply.header('Cache-Control','no-store').header('Pragma','no-cache');
      return {ok:true,reauthenticate:true};
    }catch{return reply.code(409).send({error:'Recovery key was already used; sign in again or contact support'});}
  });
  app.post<{Body:MfaBody}>('/api/auth/mfa/register/options',async(req,reply)=>{
    const session=await mfaSession(req,reply);if(!session)return;
    const config=mfaConfig();if(!config)return reply.code(503).send({error:'MFA origin not configured'});
    if(!await isAuthorizedToEnroll(session,req.body??{}))
      return reply.code(403).send({error:'Re-enter your password to enroll, or verify an enrolled factor'});
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
    const session=await mfaSession(req,reply);if(!session)return;
    const config=mfaConfig();if(!config)return reply.code(503).send({error:'MFA origin not configured'});
    const body=req.body??{};
    const challenge=await challengeFor(session,'register',body.challenge);
    if(!challenge || !await isAuthorizedToEnroll(session,body))
      return reply.code(403).send({error:'Password or enrollment authorization is invalid, or the challenge expired'});
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
        const recent=Boolean(session.mfaVerifiedAt);
        if(!recent && ['ADMIN','SUPERADMIN'].includes(session.user.role)){
          const [passkeyCount,totpCount]=await Promise.all([
            tx.adminMfaCredential.count({where:{userId:session.userId,revokedAt:null}}),
            tx.adminMfaTotp.count({where:{userId:session.userId,enabledAt:{not:null}}}),
          ]);
          await consumeEnrollmentApproval(tx,session,now,body.grantCode,
            passkeyCount+totpCount>0);
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
          summary:'Account passkey enrollment cryptographically verified',
          riskLevel:'HIGH',flagged:false,
        }});
        const recoveryKey=await issueRecoveryKey(tx,session.userId);
        return {token:await rotateElevatedSession(tx,session,now),recoveryKey};
      });
      newSessionCookie(reply,token.token,session.expiresAt);
      reply.header('Cache-Control','no-store').header('Pragma','no-cache');
      return {ok:true,recoveryKey:token.recoveryKey};
    }catch{return reply.code(409).send({error:'Enrollment authorization expired or credential already exists'});}
  });
  app.post('/api/auth/mfa/authenticate/options',async(req,reply)=>{
    const session=await mfaSession(req,reply);if(!session)return;
    const config=mfaConfig();if(!config)return reply.code(503).send({error:'MFA origin not configured'});
    const credentials=await prisma.adminMfaCredential.findMany({where:{userId:session.userId,revokedAt:null}});
    if(credentials.length===0)return reply.code(409).send({error:'No passkeys enrolled'});
    const {generateAuthenticationOptions}=await webauthn();
    const options=await generateAuthenticationOptions({
      rpID:config.rpID,userVerification:'required',
      allowCredentials:credentials.map(x=>({id:x.credentialId,transports:x.transports as any})),
    });
    await recordChallenge(session.userId,session.id,'authenticate',options.challenge);
    return options;
  });
  app.post<{Body:MfaBody}>('/api/auth/mfa/authenticate/verify',async(req,reply)=>{
    const session=await mfaSession(req,reply);if(!session)return;
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
          summary:'Account passkey verification succeeded',
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
  app.post<{Body:{grantCode?:string;password?:string}}>('/api/auth/mfa/totp/setup',async(req,reply)=>{
    const session=await mfaSession(req,reply);if(!session)return;
    const activePasskeys=await prisma.adminMfaCredential.count({where:{userId:session.userId,revokedAt:null}});
    if(activePasskeys>0)return reply.code(409).send({error:'This account uses passkey-only MFA; authenticator setup and verification are disabled'});
    if(!totpIsEnabled())return reply.code(404).send({error:'Authenticator app setup is unavailable'});
    const key=requireTotpEncryptionKey();
    const existing=await prisma.adminMfaTotp.findUnique({where:{userId:session.userId}});
    if(existing?.enabledAt) return reply.code(409).send({error:'Authenticator already enrolled; verified factor recovery required to replace it'});
    if(!await isAuthorizedToEnroll(session,req.body??{}))
      return reply.code(403).send({error:'Re-enter your password to enroll, or verify an enrolled factor'});
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
  app.post<{Body:{grantCode?:string;code?:string;password?:string}}>('/api/auth/mfa/totp/confirm',async(req,reply)=>{
    const session=await mfaSession(req,reply);if(!session)return;
    const activePasskeys=await prisma.adminMfaCredential.count({where:{userId:session.userId,revokedAt:null}});
    if(activePasskeys>0)return reply.code(409).send({error:'This account uses passkey-only MFA; authenticator setup and verification are disabled'});
    if(!totpIsEnabled())return reply.code(404).send({error:'Authenticator app setup is unavailable'});
    const row=await prisma.adminMfaTotp.findUnique({where:{userId:session.userId}});
    const now=new Date();
    if(!row?.pendingCiphertext || !row.pendingExpiresAt || row.pendingExpiresAt<=now || row.enabledAt)
      return reply.code(409).send({error:'Authenticator setup expired; start again'});
    if(!await isAuthorizedToEnroll(session,req.body??{}))
      return reply.code(403).send({error:'Password or enrollment authorization is invalid'});
    let step:bigint|null=null;
    try{
      step=findTotpStep(decryptTotpSecret(row.pendingCiphertext,requireTotpEncryptionKey()),
        req.body?.code,now.getTime());
    }catch{return reply.code(503).send({error:'Authenticator setup cannot be verified'});}
    if(step===null)return reply.code(400).send({error:'Invalid or expired authenticator code'});
    try{
      const token=await prisma.$transaction(async tx=>{
        const recent=Boolean(session.mfaVerifiedAt);
        if(!recent && ['ADMIN','SUPERADMIN'].includes(session.user.role)){
          const [passkeyCount,totpCount]=await Promise.all([
            tx.adminMfaCredential.count({where:{userId:session.userId,revokedAt:null}}),
            tx.adminMfaTotp.count({where:{userId:session.userId,enabledAt:{not:null}}}),
          ]);
          await consumeEnrollmentApproval(tx,session,now,req.body?.grantCode,
            passkeyCount+totpCount>0);
        }
        const claimed=await tx.adminMfaTotp.updateMany({
          where:{userId:session.userId,pendingCiphertext:row.pendingCiphertext,
            pendingExpiresAt:{gt:now},enabledAt:null},
          data:{secretCiphertext:row.pendingCiphertext,pendingCiphertext:null,
            pendingExpiresAt:null,enabledAt:now,lastUsedStep:step,
            failedAttempts:0,lastFailedAt:null,lockedUntil:null},
        });
        if(claimed.count!==1)throw new Error('TOTP setup already consumed');
        await tx.adminAuditLog.create({data:{
          actorEmail:session.user.email,actorName:session.user.name,
          action:'security.mfa.totp.enrolled',targetType:'User',targetId:session.userId,
          summary:'Account authenticator app enrolled with verified TOTP code',
          riskLevel:'HIGH',flagged:false,
        }});
        const recoveryKey=await issueRecoveryKey(tx,session.userId);
        return {token:await rotateElevatedSession(tx,session,now,'TOTP'),recoveryKey};
      });
      newSessionCookie(reply,token.token,session.expiresAt);
      reply.header('Cache-Control','no-store').header('Pragma','no-cache');
      return {ok:true,recoveryKey:token.recoveryKey};
    }catch{return reply.code(409).send({error:'Authenticator setup or enrollment grant already used'});}
  });
  app.post<{Body:{code?:string}}>('/api/auth/mfa/totp/verify',async(req,reply)=>{
    const session=await mfaSession(req,reply);if(!session)return;
    const activePasskeys=await prisma.adminMfaCredential.count({where:{userId:session.userId,revokedAt:null}});
    if(activePasskeys>0)return reply.code(409).send({error:'This account uses passkey-only MFA; authenticator setup and verification are disabled'});
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

  app.post<{Params:{id:string};Body:{recoveryKey?:string}}>('/api/admin/mfa/recovery/:id/approve',async(req,reply)=>{
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
        // A saved one-time recovery key may be supplied as additional proof.
        // It never replaces either independent superadmin approval.
        if(req.body?.recoveryKey!==undefined){
          const key=req.body.recoveryKey;
          if(typeof key!=='string' || !/^[A-Za-z0-9_-]{43}$/.test(key))
            throw new Error('Invalid recovery proof');
          const claimedCode=await tx.adminMfaRecoveryCode.updateMany({
            where:{userId:target.id,codeHash:digest(key),usedAt:null,
              OR:[{lockedUntil:null},{lockedUntil:{lt:now}}]},
            data:{usedAt:now},
          });
          if(claimedCode.count!==1)throw new Error('Recovery proof already used');
        }
        await tx.adminMfaEnrollmentGrant.updateMany({
          where:{userId:target.id,consumedAt:null},data:{consumedAt:now},
        });
        await tx.adminMfaCredential.updateMany({
          where:{userId:target.id,revokedAt:null},data:{revokedAt:now},
        });
        // Revocation invalidates every old backup key even when the
        // administrator completed approved recovery without presenting one.
        await tx.adminMfaRecoveryCode.updateMany({
          where:{userId:target.id,usedAt:null},data:{usedAt:now},
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
