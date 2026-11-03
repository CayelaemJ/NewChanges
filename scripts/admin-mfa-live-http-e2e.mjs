// Full synthetic HTTP + Chromium virtual-authenticator MFA flow. No hardware,
// cloud APIs, production accounts or persistent database access.
// Runs ONLY after schema setup on the disposable local CI PostgreSQL instance.
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {chromium} from 'playwright';

const fixtureUrl='postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci';
if(process.env.DATABASE_URL!==fixtureUrl ||
  process.env.CI!=='true' ||
  process.env.CI_RLS_PROBE_APPROVED!=='CI_DISPOSABLE_ONLY')
 throw Error('Refusing to run MFA live HTTP test outside disposable local CI database');

process.env.COOKIE_SECURE='false';
process.env.STANDBY_MODE='true';
process.env.TRAFFIC_SAVER_MODE='true';
process.env.ADMIN_MFA_ENFORCE='true';
process.env.ADMIN_MFA_TOTP_ENABLED='true';
process.env.ADMIN_MFA_TOTP_ENCRYPTION_KEY=randomBytes(32).toString('base64url');
process.env.MFA_RP_ID='localhost';
const port=39731;
const origin='http://localhost:'+port;
process.env.MFA_EXPECTED_ORIGIN=origin;
// No MFA_STAGING_ONLY flags: this test binds to localhost and is not a Render service.
const [{totpCode,decryptTotpSecret,requireTotpEncryptionKey},{app},{prisma},{hashPassword}] = await Promise.all([
 import('../dist/services/adminTotp.js'),
 import('../dist/server.js'),import('../dist/services/database.js'),
 import('../dist/services/authService.js')
]);
const nonce=randomBytes(8).toString('hex');
const records=[];
const users=[
 {email:'mfa-e2e-a-'+nonce+'@example.invalid',name:'Synthetic Approver A',role:'SUPERADMIN'},
 {email:'mfa-e2e-b-'+nonce+'@example.invalid',name:'Synthetic Approver B',role:'SUPERADMIN'},
 {email:'mfa-e2e-target-'+nonce+'@example.invalid',name:'Synthetic Recovery Target',role:'ADMIN'},
].map(x=>({...x,password:randomBytes(32).toString('base64url'),
  grant:randomBytes(32).toString('base64url')}));
let browser;
let listening=false;
const hash=value=>createHash('sha256').update(value).digest('hex');

async function authenticatorContext(){
 const ctx=await browser.newContext({baseURL:origin});
 const page=await ctx.newPage();
 const cdp=await ctx.newCDPSession(page);
 await cdp.send('WebAuthn.enable');
 await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{
  protocol:'ctap2',transport:'internal',
  hasResidentKey:true,hasUserVerification:true,isUserVerified:true,
  automaticPresenceSimulation:true,
 }});
 return {ctx,page};
}
async function postFrom(context,path,data){
 return context.request.post(path,{data,headers:{Origin:origin}});
}
async function loginAndLoad(user){
 const item=await authenticatorContext();
 const response=await postFrom(item.ctx,'/api/auth/login',{
  email:user.email,password:user.password
 });
 assert.equal(response.status(),200,'Synthetic account must log in with its own password');
 const signIn=await response.json();
 assert.equal(signIn.mfaRequired,true,'Administrator password login must require passkey enrollment/verification');
 assert.equal(signIn.next,'/mfa','Login must direct administrators to the passkey setup page');
 const limitedProfile=await item.ctx.request.get('/api/auth/me');
 assert.equal(limitedProfile.status(),200);
 const preMfaProfile=await limitedProfile.json();
 assert.equal(preMfaProfile.mfaRequired,true,'Existing admin must be forced to enroll MFA');
 assert.deepEqual(preMfaProfile.employers,[],'Unverified admin must not receive employer records');
 assert.equal(preMfaProfile.modules.admin,false,'Unverified admin cannot reach admin modules');
 const unverified=await item.ctx.request.get('/dashboard',{maxRedirects:0});
 assert.equal(unverified.status(),302,'Direct dashboard access must require passkey step-up');
 assert.equal(unverified.headers().location,'/mfa');
 const react=await item.ctx.request.get('/react/dashboard',{maxRedirects:0});
 assert.equal(react.status(),302,'React dashboard must not bypass the passkey redirect');
 assert.equal(react.headers().location,'/mfa');
 await item.page.goto(origin+'/mfa',{waitUntil:'domcontentloaded'});
 await item.page.waitForFunction(()=>!(document.querySelector('#status')?.textContent||'').includes('Checking your account security'),null,{timeout:20000});
 return item;
}
async function enroll(item,grant){
 await item.page.locator('#grant').fill(grant);
 await item.page.locator('#enroll').click();
 // Registration rotates the server-side session and refreshes MFA status.
 // Assert the authoritative verified completion state, not stale status copy.
 await item.page.locator('#mfa-success').waitFor({state:'visible',timeout:20000});
 await assert.doesNotReject(async()=>{
   const response=await item.ctx.request.get('/api/auth/mfa/status');
   assert.equal(response.status(),200);
   const state=await response.json();
   assert.equal(state.verified,true,'Passkey enrollment must elevate the active session');
   assert.equal(state.passkeyEnrolled,true,'Server must persist enrolled passkey');
 });
}
try{
 for(const user of users){
  const saved=await prisma.user.create({data:{
   email:user.email,name:user.name,role:user.role,active:true,
   createdBy:'ci-disposable-mfa-e2e',passwordHash:hashPassword(user.password),
  }});
  user.id=saved.id;records.push(saved.id);
 }
 for(const u of users){
  await prisma.adminMfaEnrollmentGrant.create({data:{
   userId:u.id,codeHash:hash(u.grant),
   expiresAt:new Date(Date.now()+15*60_000),
   approvedByOne:'ci-synthetic-first',approvedByTwo:'ci-synthetic-second',
  }});
 }
 // A separate ADMIN must enrol an authenticator app from an approved grant,
 // scan an actual locally rendered QR, confirm the first six-digit code,
 // reject a replay, and verify a fresh time step before recovery.
 // Simulate a credential held by the recovery target. It must be revoked by
 // the atomic recovery transaction even though it is not used to authenticate.
 const toRevoke=await prisma.adminMfaCredential.create({data:{
  userId:users[2].id,credentialId:'ci-synthetic-unused-'+nonce,
  publicKey:randomBytes(65).toString('base64url'),signCount:0n,transports:[],
 }});
 await app.listen({host:'127.0.0.1',port});
 listening=true;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const totpAdmin=await loginAndLoad(users[2]);
 const qr=await postFrom(totpAdmin.ctx,'/api/auth/mfa/totp/setup',
   {grantCode:users[2].grant});
 assert.equal(qr.status(),200,'Synthetic ADMIN must receive a QR-code setup');
 const provisioning=await qr.json();
 assert.ok(provisioning.qrDataUri.startsWith('data:image/svg+xml;base64,'),'TOTP QR must be a local encoded SVG');
 assert.match(provisioning.manualKey,/^[A-Z2-7]{32}$/);
 const now=Date.now();
 const firstCode=totpCode(provisioning.manualKey,Math.floor(now/30000));
 const confirmed=await postFrom(totpAdmin.ctx,'/api/auth/mfa/totp/confirm',
   {grantCode:users[2].grant,code:firstCode});
 assert.equal(confirmed.status(),200,'QR-scanned TOTP setup must activate after real code');
 const replay=await postFrom(totpAdmin.ctx,'/api/auth/mfa/totp/verify',
   {code:firstCode});
 assert.equal(replay.status(),403,'First TOTP time step cannot be replayed');
 const nextCode=totpCode(provisioning.manualKey,Math.floor(Date.now()/30000)+1);
 const elevatedTotp=await postFrom(totpAdmin.ctx,'/api/auth/mfa/totp/verify',
   {code:nextCode});
 assert.equal(elevatedTotp.status(),200,'New TOTP time step verifies administrator');
 const pending=await prisma.adminMfaTotp.findUnique({where:{userId:users[2].id}});
 assert.ok(pending.enabledAt && pending.lastUsedStep!==null,
  'Secret is stored in encrypted durable database and replay counter is set');
 assert.ok(!pending.secretCiphertext.includes(provisioning.manualKey));
 assert.equal(pending.pendingCiphertext,null,'Confirmed QR enrollment must clear temporary seed');
 assert.equal(pending.pendingExpiresAt,null,'Confirmed QR enrollment must clear temporary expiry');
 assert.equal(decryptTotpSecret(pending.secretCiphertext,requireTotpEncryptionKey()),
   provisioning.manualKey,'Database ciphertext must decrypt to the same authenticator seed after confirmation');
 assert.throws(()=>decryptTotpSecret(pending.secretCiphertext,randomBytes(32)),
   'A different encryption key must not decrypt the persisted authenticator seed');
 const durableRead=await prisma.adminMfaTotp.findUnique({
   where:{userId:users[2].id},select:{enabledAt:true,secretCiphertext:true}
 });
 assert.ok(durableRead?.enabledAt && durableRead.secretCiphertext===pending.secretCiphertext,
   'Separate database read must retain the encrypted enabled MFA seed');

 const A=await loginAndLoad(users[0]);
 const pre=await postFrom(A.ctx,'/api/admin/mfa/recovery/request',{
  targetUserId:users[2].id});
 assert.equal(pre.status(),403,'Privileged recovery must fail before passkey');
 assert.equal((await pre.json()).code,'MFA_REQUIRED','Refusal must be MFA step-up, not CSRF');
 await enroll(A,users[0].grant);
 const elevatedDashboard=await A.ctx.request.get('/dashboard',{maxRedirects:0});
 assert.equal(elevatedDashboard.status(),200,
   'After verified passkey, the signed-in admin can open the dashboard');
 const B=await loginAndLoad(users[1]);
 await enroll(B,users[1].grant);
 const elevated=await prisma.session.findFirst({
  where:{userId:users[0].id,endedAt:null,revokedAt:null,mfaVerifiedAt:{not:null}}
 });
 assert.ok(elevated,'Verified WebAuthn enrollment must persist MFA on an active rotated session');
 // A signed assertion must be exercised from a fresh, password-only session.
 // After enrollment the redesigned UI shows the completion state instead of
 // asking for an unnecessary second verification. Reauthenticate in the SAME
 // browser context so the virtual authenticator retains the enrolled passkey.
 const reauth=await postFrom(B.ctx,'/api/auth/login',{
   email:users[1].email,password:users[1].password
 });
 assert.equal(reauth.status(),200,'Returning superadmin must reauthenticate');
 assert.equal((await reauth.json()).mfaRequired,true);
 await B.page.reload({waitUntil:'domcontentloaded'});
 await B.page.locator('#verify').waitFor({state:'visible'});
 const signedAssertion=B.page.waitForResponse(response=>
   response.url().endsWith('/api/auth/mfa/authenticate/verify'),{timeout:20000});
 await B.page.locator('#verify').click();
 const assertionResponse=await signedAssertion;
 assert.equal(assertionResponse.status(),200,
   'Signed WebAuthn assertion must be verified by Fastify before recovery');
 const asserted=await assertionResponse.json();
 assert.equal(asserted.ok,true);
 const signedSession=await prisma.session.findFirst({
  where:{userId:users[1].id,endedAt:null,revokedAt:null,mfaVerifiedAt:{not:null}},
 });
 assert.ok(signedSession,'Signed assertion must establish a fresh active session');
 const first=await postFrom(A.ctx,'/api/admin/mfa/recovery/request',{
   targetUserId:users[2].id});
 assert.equal(first.status(),200,'Verified superadmin A may request recovery');
 const requested=await first.json();
 const self=await postFrom(A.ctx,
   '/api/admin/mfa/recovery/'+requested.requestId+'/approve',{});
 assert.equal(self.status(),409,'First approver cannot approve their own request');
 const approved=await postFrom(B.ctx,
   '/api/admin/mfa/recovery/'+requested.requestId+'/approve',{});
 assert.equal(approved.status(),200,'Different verified superadmin B can approve');
 const recovery=await approved.json();
 assert.match(recovery.grantCode,/^[A-Za-z0-9_-]{43}$/);
 const removedTotp=await prisma.adminMfaTotp.findUnique({where:{userId:users[2].id}});
 assert.equal(removedTotp,null,'Two-person recovery revokes the previously enrolled TOTP factor');
 const revoked=await prisma.adminMfaCredential.findUnique({where:{id:toRevoke.id}});
 assert.ok(revoked.revokedAt,'Prior target passkey must be revoked');
 const used=await postFrom(B.ctx,
   '/api/admin/mfa/recovery/'+requested.requestId+'/approve',{});
 assert.equal(used.status(),409,'Recovery request can be used only once');
 const T=await loginAndLoad(users[2]);
 await enroll(T,recovery.grantCode);
 const newCredential=await prisma.adminMfaCredential.findFirst({
  where:{userId:users[2].id,revokedAt:null}
 });
 assert.ok(newCredential,'Recovered target has registered a replacement passkey');
 assert.notEqual(newCredential.id,toRevoke.id);
 console.log('PASS MFA real HTTP/virtual passkey: password login, signed enrollment and assertion, step-up guard, dual approval, atomic credential revocation, one-time recovery and replacement enrollment.');
}finally{
 if(browser)await browser.close();
 if(listening)await app.close();
 // Never clean up an application database; we only ever reached this code
 // after the exact disposable URL, CI flag and synthetic marker were checked.
 if(records.length)await prisma.user.deleteMany({where:{id:{in:records}}});
 await prisma.$disconnect();
}
