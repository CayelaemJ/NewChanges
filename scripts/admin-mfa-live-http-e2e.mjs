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

process.env.MFA_E2E_TEST_RATE_LIMIT='true';
process.env.COOKIE_SECURE='false';
process.env.STANDBY_MODE='true';
process.env.TRAFFIC_SAVER_MODE='true';
process.env.MFA_ENFORCE='true';
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
const tenantRecords=[];
const tenantA='mfa-tenant-a-'+nonce;
const tenantB='mfa-tenant-b-'+nonce;
const users=[
 {email:'mfa-e2e-a-'+nonce+'@example.invalid',name:'Synthetic Approver A',role:'SUPERADMIN'},
 {email:'mfa-e2e-b-'+nonce+'@example.invalid',name:'Synthetic Approver B',role:'SUPERADMIN'},
 {email:'mfa-e2e-target-'+nonce+'@example.invalid',name:'Synthetic Recovery Target',role:'ADMIN'},
 {email:'mfa-e2e-onboard-'+nonce+'@example.invalid',name:'Synthetic First-Time Admin',role:'ADMIN'},
 {email:'mfa-e2e-onboard-qr-'+nonce+'@example.invalid',name:'Synthetic QR Enrollee',role:'ADMIN'},
 {email:'mfa-e2e-viewer-'+nonce+'@example.invalid',name:'Synthetic Read-Only User',role:'VIEWER'},
 {email:'mfa-e2e-employer-'+nonce+'@example.invalid',name:'Synthetic Employer Manager',role:'EMPLOYER_MANAGER'},
 {email:'mfa-e2e-portfolio-'+nonce+'@example.invalid',name:'Synthetic Portfolio Manager',role:'PORTFOLIO_MANAGER'},
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
 const cookie=response.headers()['set-cookie']||'';
 assert.match(cookie,/HttpOnly/i,'Administrator session cookie must be HttpOnly');
 assert.match(cookie,/SameSite=Lax/i,'Administrator session cookie must constrain cross-site use');
 const signIn=await response.json();
 assert.equal(signIn.mfaRequired,true,'Every account password login must require passkey enrollment/verification');
 assert.equal(signIn.next,'/mfa','Login must direct administrators to the passkey setup page');
 const limitedProfile=await item.ctx.request.get('/api/auth/me');
 assert.equal(limitedProfile.status(),200);
 const mfaStatus=await item.ctx.request.get('/api/auth/mfa/status');
 assert.equal(mfaStatus.status(),200,
   `MFA status failed (${mfaStatus.status()}): ${await mfaStatus.text()}`);
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
 // Synthetic bootstrap and independently approved recovery use the guarded
 // legacy grant fallback. Ordinary users instead request server-side approval.
 await item.page.locator('#mfa-legacy-details summary').click();
 await item.page.locator('#mfa-legacy-grant').fill(grant);
 await item.page.locator('#mfa-legacy-apply').click();
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
async function enrollRegularAccount(item,user){
 // Every non-admin account must be able to complete MFA enrollment using its
 // own password, with no administrator grant or recovery approval.
 await item.page.locator('#mfa-enrollment-password').fill(user.password);
 await item.page.locator('#enroll').click();
 await item.page.locator('#mfa-success').waitFor({state:'visible',timeout:20000});
 const response=await item.ctx.request.get('/api/auth/mfa/status');
 assert.equal(response.status(),200,'Regular account MFA status must be available after enrollment');
 const state=await response.json();
 assert.equal(state.verified,true,'Regular account enrollment must verify its session');
 assert.equal(state.passkeyEnrolled,true,'Regular account passkey must be persisted');
 const recovery=await prisma.adminMfaRecoveryCode.findUnique({where:{userId:user.id}});
 assert.ok(recovery && !recovery.usedAt,
  'Every regular account must receive an unused one-time recovery key record');
 assert.match(recovery.codeHash,/^[a-f0-9]{64}$/,
  'Regular account recovery keys must be stored only as a digest');
}
async function assertTenantScope(context,ownEmployerId,foreignEmployerId,roleName){
 const profileResponse=await context.request.get('/api/auth/me');
 assert.equal(profileResponse.status(),200,roleName+' profile must load after MFA');
 const profile=await profileResponse.json();
 assert.deepEqual(profile.employers.map(row=>row.id),[ownEmployerId],
  roleName+' profile must expose only its linked employer');
 const own=await context.request.get('/api/employers/'+encodeURIComponent(ownEmployerId)+'/periods');
 assert.ok(![401,403].includes(own.status()),
  roleName+' must reach the linked employer route (downstream data may be empty)');
 for(const route of ['periods','score-history','dashboard']){
  const response=await context.request.get('/api/employers/'+encodeURIComponent(foreignEmployerId)+'/'+route);
  assert.equal(response.status(),403,
   roleName+' must be denied cross-tenant '+route+' access before data lookup');
 }
}
try{
 for(const user of users){
  const saved=await prisma.user.create({data:{
   email:user.email,name:user.name,role:user.role,active:true,
   createdBy:'ci-disposable-mfa-e2e',passwordHash:hashPassword(user.password),
  }});
  user.id=saved.id;records.push(saved.id);
 }
 await prisma.employer.createMany({data:[
  {id:tenantA,name:'Synthetic Tenant A '+nonce},
  {id:tenantB,name:'Synthetic Tenant B '+nonce},
 ]});
 tenantRecords.push(tenantA,tenantB);
 for(const [userIndex,employerId] of [[5,tenantA],[6,tenantA],[7,tenantB]])
  await prisma.userEmployer.create({data:{userId:users[userIndex].id,employerId}});
 for(const u of users.slice(0,3)){
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
 const confirmation=await confirmed.json();
 assert.match(confirmation.recoveryKey,/^[A-Za-z0-9_-]{43}$/,'First MFA enrollment issues a strong one-time recovery key');
 const recoveryRecord=await prisma.adminMfaRecoveryCode.findUnique({where:{userId:users[2].id}});
 assert.equal(recoveryRecord.codeHash,hash(confirmation.recoveryKey),'Only a hash of the recovery key is persisted');
 assert.equal(recoveryRecord.usedAt,null);

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

 // Force a verified TOTP session beyond the ten-minute privilege window.
 const activeTargetSession=await prisma.session.findFirst({
   where:{userId:users[2].id,endedAt:null,revokedAt:null,mfaVerifiedAt:{not:null}}
 });
 assert.ok(activeTargetSession,'TOTP elevation must have an active durable session');
 await prisma.session.update({where:{id:activeTargetSession.id},
   data:{mfaVerifiedAt:new Date(Date.now()-11*60_000)}});
 const stalePrivilege=await totpAdmin.ctx.request.get('/api/admin/reports');
 assert.equal(stalePrivilege.status(),403,'Old MFA session must lose privileged read access');
 assert.equal((await stalePrivilege.json()).code,'MFA_REQUIRED');

 const A=await loginAndLoad(users[0]);
 // Real Fastify HTTP authorization checks against synthetic sessions.
 // A password-only superadmin must not access protected business API reads
 // or use a guessed privileged mutation URL.
 // Probe every statically registered protected GET endpoint, not only a sample.
 const {apiRouteInventory}=await import('./ci/api-route-inventory.mjs');
 const inventory=apiRouteInventory().routes;
 const protectedGets=inventory.filter(x=>x.method==='GET' &&
   !x.path.startsWith('/api/auth/') && x.path!=='/api/contact' &&
   !x.path.startsWith('/api/public/') && !x.path.startsWith('/api/partner-theme/'));
 assert.ok(protectedGets.length>=12,'Runtime authorization route inventory unexpectedly small');
 for(const item of protectedGets){
   const endpoint=item.path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g,'ci-test-missing')
     .replace(/\*/g,'ci-test-missing');
   const response=await A.ctx.request.get(endpoint,{maxRedirects:0});
   const status=response.status();
   // 400 is permitted only on parametrized URLs validated before preHandler.
   assert.ok(status===403 || (item.path.includes(':') && status===400),
     'Password-only administrator reached or bypassed '+item.path+' (status '+status+')');
   if(status===403){
     const denied=await response.json();
     assert.equal(denied.code,'MFA_REQUIRED',
       'MFA step-up missing on real registered endpoint '+item.path);
   }
 }
 console.log('PASS protected Fastify GET API inventory:',protectedGets.length,'routes denied before MFA');
 const unverifiedWrite=await postFrom(A.ctx,'/api/admin/mfa/recovery/request',{targetUserId:users[2].id});
 assert.equal(unverifiedWrite.status(),403,'Unverified superadmin cannot mutate recovery state');
 assert.equal((await unverifiedWrite.json()).code,'MFA_REQUIRED');
 const anonymous=await browser.newContext({baseURL:origin});
 try{
   const anonymousRead=await anonymous.request.get('/api/admin/reports');
   assert.ok([401,403].includes(anonymousRead.status()),'Anonymous API may not disclose reports');
   const anonymousRecovery=await anonymous.request.post('/api/admin/mfa/recovery/request',{data:{targetUserId:users[2].id},headers:{Origin:origin}});
   assert.ok([401,403].includes(anonymousRecovery.status()),'Anonymous recovery must be denied');
 }finally{await anonymous.close();}
 const viewer=await loginAndLoad(users[5]);
 try {
   const viewerProfile=await viewer.ctx.request.get('/api/auth/me');
   assert.equal(viewerProfile.status(),200);
   const restrictedViewer=await viewerProfile.json();
   assert.equal(restrictedViewer.mfaRequired,true,'Viewer profile must report required MFA');
   assert.deepEqual(restrictedViewer.employers,[],'Unverified viewer must not receive employer records');
   assert.deepEqual(restrictedViewer.modules,{admin:false,dashboard:false,portfolio:false,users:false},
     'Unverified viewer must not receive module entitlements');
   const viewerBusinessRead=await viewer.ctx.request.get('/api/dashboard/version');
   assert.equal(viewerBusinessRead.status(),403,'Viewer business API access must wait for MFA');
   assert.equal((await viewerBusinessRead.json()).code,'MFA_REQUIRED');
   for(const protectedPath of ['/api/admin/reports','/api/admin/integration',
     '/api/admin/compliance/overview','/api/admin/security/overview']){
     const denied=await viewer.ctx.request.get(protectedPath);
     assert.equal(denied.status(),403,
       'Read-only user must not access administrative data: '+protectedPath);
   }
   const illegalApproval=await postFrom(viewer.ctx,'/api/admin/mfa/recovery/request',
     {targetUserId:users[2].id});
   assert.equal(illegalApproval.status(),403,'Viewer cannot start administrator recovery');
   await enrollRegularAccount(viewer,users[5]);
   await assertTenantScope(viewer.ctx,tenantA,tenantB,'Viewer');
 }finally{await viewer.ctx.close();}

 for(const [index,roleName] of [[6,'Employer manager'],[7,'Portfolio manager']]){
   const account=users[index];
   const item=await loginAndLoad(account);
   try{
     const profile=await item.ctx.request.get('/api/auth/me');
     assert.equal(profile.status(),200);
     assert.equal((await profile.json()).mfaRequired,true,roleName+' profile must report required MFA');
     const businessRead=await item.ctx.request.get('/api/dashboard/version');
     assert.equal(businessRead.status(),403,roleName+' business API access must wait for MFA');
     assert.equal((await businessRead.json()).code,'MFA_REQUIRED');
     await enrollRegularAccount(item,account);
     await assertTenantScope(item.ctx,index===6?tenantA:tenantB,index===6?tenantB:tenantA,roleName);
   }finally{await item.ctx.close();}
 }
 console.log('PASS all-account MFA enrollment and tenant HTTP isolation: viewer, employer manager and portfolio manager');

 const pre=await postFrom(A.ctx,'/api/admin/mfa/recovery/request',{
  targetUserId:users[2].id});
 assert.equal(pre.status(),403,'Privileged recovery must fail before passkey');
 assert.equal((await pre.json()).code,'MFA_REQUIRED','Refusal must be MFA step-up, not CSRF');
 await enroll(A,users[0].grant);
 // Simulate a pre-existing superadmin whose MFA predates recovery keys.
 await prisma.adminMfaRecoveryCode.delete({where:{userId:users[0].id}});
 const legacyBlocked=await A.ctx.request.get('/dashboard',{maxRedirects:0});
 assert.equal(legacyBlocked.status(),302,'Superadmin missing key is redirected to MFA setup');
 assert.equal(legacyBlocked.headers().location,'/mfa');
 const privateProfile=await A.ctx.request.get('/api/auth/me');
 assert.equal(privateProfile.status(),200,'Restricted profile reports next security step');
 const restricted=await privateProfile.json();
 assert.equal(restricted.recoveryKeyRequired,true,'Missing recovery key must be reported');
 assert.deepEqual(restricted.employers,[],'Missing key must never reveal employer records');
 assert.equal(restricted.modules.admin,false,'Missing key must not grant admin modules');
 const noKeyApi=await postFrom(A.ctx,'/api/admin/mfa/recovery/request',
   {targetUserId:users[2].id});
 assert.equal(noKeyApi.status(),403,'Admin API denies missing recovery key');
 assert.equal((await noKeyApi.json()).code,'RECOVERY_KEY_REQUIRED');
 const legacyIssue=await postFrom(A.ctx,'/api/auth/mfa/recovery-key/issue',{});
 assert.equal(legacyIssue.status(),200,'Existing verified superadmin can obtain first recovery key');
 const issuedKey=(await legacyIssue.json()).recoveryKey;
 assert.match(issuedKey,/^[A-Za-z0-9_-]{43}$/);
 const legacyKey=await prisma.adminMfaRecoveryCode.findUnique({where:{userId:users[0].id}});
 assert.equal(legacyKey.codeHash,hash(issuedKey),'Recovery key never stored in plaintext');
 const repeatIssue=await postFrom(A.ctx,'/api/auth/mfa/recovery-key/issue',{});
 assert.equal(repeatIssue.status(),409,'Recovery key cannot be displayed twice');
 const crossOrigin=await A.ctx.request.post('/api/admin/mfa/recovery/request',{
   data:{targetUserId:users[2].id},headers:{Origin:'https://untrusted.invalid'}
 });
 assert.equal(crossOrigin.status(),403,'Cross-origin cookie-based mutation must be blocked');
 const readHeaders=await A.ctx.request.get('/api/admin/reports');
 assert.equal(readHeaders.status(),200,'Fresh passkey unlocks authorized business API');
 assert.equal(readHeaders.headers()['x-frame-options'],'DENY');
 assert.equal(readHeaders.headers()['x-content-type-options'],'nosniff');

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
 // Normal onboarding: the user never invents or receives an enrollment grant.
 // Password-only login can request approval but cannot set up a passkey.
 const O=await loginAndLoad(users[3]);
 const premature=await postFrom(O.ctx,'/api/auth/mfa/register/options',{});
 assert.equal(premature.status(),403,'Password alone cannot register the first MFA factor');
 const enrollmentRequest=await postFrom(O.ctx,'/api/auth/mfa/enrollment/request',{});
 assert.equal(enrollmentRequest.status(),200,'First-time administrator can request server-managed enrollment');
 const enrollment=await enrollmentRequest.json();
 assert.ok(enrollment.requestId,'Server generates a request ID without a user-generated grant');
 assert.equal(enrollment.approved,false);
 const selfApprove=await postFrom(O.ctx,
  '/api/admin/mfa/enrollment/'+enrollment.requestId+'/approve',{identityConfirmed:true});
 assert.equal(selfApprove.status(),403,'Enrollment requester cannot authorize their own MFA setup');
 const withoutIdentity=await postFrom(A.ctx,
  '/api/admin/mfa/enrollment/'+enrollment.requestId+'/approve',{identityConfirmed:false});
 assert.equal(withoutIdentity.status(),400,'Approvers must declare independent identity verification');
 const approvalOne=await postFrom(A.ctx,
  '/api/admin/mfa/enrollment/'+enrollment.requestId+'/approve',{identityConfirmed:true});
 assert.equal(approvalOne.status(),200,'Verified superadmin A issues first enrollment approval');
 assert.equal((await approvalOne.json()).approved,false,'One approval cannot unlock enrollment');
 const afterOne=await postFrom(O.ctx,'/api/auth/mfa/register/options',{});
 assert.equal(afterOne.status(),403,'One approval cannot bypass initial enrollment gate');
 const doubleApprove=await postFrom(A.ctx,
  '/api/admin/mfa/enrollment/'+enrollment.requestId+'/approve',{identityConfirmed:true});
 assert.equal(doubleApprove.status(),409,'Same superadmin cannot provide both approvals');
 const approvalTwo=await postFrom(B.ctx,
  '/api/admin/mfa/enrollment/'+enrollment.requestId+'/approve',{identityConfirmed:true});
 assert.equal(approvalTwo.status(),200,'Independent verified superadmin B completes enrollment approval');
 assert.equal((await approvalTwo.json()).approved,true);
 const secondLogin=await loginAndLoad(users[3]);
 const otherSessionAttempt=await postFrom(secondLogin.ctx,'/api/auth/mfa/register/options',{});
 assert.equal(otherSessionAttempt.status(),403,'Approval cannot be used from a different password session');
 await secondLogin.ctx.close();
 await O.page.reload({waitUntil:'domcontentloaded'});
 await O.page.waitForFunction(
   ()=>document.querySelector('#mfa-approval-state')?.textContent?.includes('Setup approved'),
   null,{timeout:20000});
 await O.page.locator('#enroll').waitFor({state:'visible'});
 assert.equal(await O.page.locator('#enroll').isEnabled(),true,
  'Approved first-time enrollment must enable passkey registration without a grant');
 await O.page.locator('#enroll').click();
 await O.page.locator('#mfa-success').waitFor({state:'visible',timeout:20000});
 const persisted=await prisma.adminMfaEnrollmentRequest.findUnique({where:{id:enrollment.requestId}});
 assert.ok(persisted?.consumedAt,'One-time server-managed approval must be consumed on enrollment');
 const replayEnrollment=await postFrom(A.ctx,
  '/api/admin/mfa/enrollment/'+enrollment.requestId+'/approve',{identityConfirmed:true});
 assert.equal(replayEnrollment.status(),409,'Consumed authorization cannot be approved again');

 // Prove that the very same invisible authorization also works for QR-based
 // authenticator enrollment. No 43-character enrollment grant is issued.
 const Q=await loginAndLoad(users[4]);
 const qrRequest=await postFrom(Q.ctx,'/api/auth/mfa/enrollment/request',{});
 assert.equal(qrRequest.status(),200,'Authenticator-only new user can request first-time setup');
 const qrRequestId=(await qrRequest.json()).requestId;
 for(const approver of [A,B]){
   const allowed=await postFrom(approver.ctx,
     '/api/admin/mfa/enrollment/'+qrRequestId+'/approve',{identityConfirmed:true});
   assert.equal(allowed.status(),200,'Separate passkey-verified superadmins approve QR enrollment');
 }
 const grantFreeQr=await postFrom(Q.ctx,'/api/auth/mfa/totp/setup',{});
 assert.equal(grantFreeQr.status(),200,'Approved user can generate a QR without any enrollment grant');
 const qrSecret=await grantFreeQr.json();
 assert.ok(qrSecret.qrDataUri.startsWith('data:image/svg+xml;base64,'));
 const qrCode=totpCode(qrSecret.manualKey,Math.floor(Date.now()/30000));
 const qrConfirmed=await postFrom(Q.ctx,'/api/auth/mfa/totp/confirm',{code:qrCode});
 assert.equal(qrConfirmed.status(),200,'First authenticator code activates the saved encrypted secret without grant');
 const qrApproval=await prisma.adminMfaEnrollmentRequest.findUnique({where:{id:qrRequestId}});
 assert.ok(qrApproval?.consumedAt,'QR enrollment must consume the invisible server approval');
 const qrRecord=await prisma.adminMfaTotp.findUnique({where:{userId:users[4].id}});
 assert.ok(qrRecord?.enabledAt && qrRecord.secretCiphertext &&
   !qrRecord.secretCiphertext.includes(qrSecret.manualKey),
   'QR enrollment persists ciphertext, not the plaintext authenticator key');

 const first=await postFrom(A.ctx,'/api/admin/mfa/recovery/request',{
   targetUserId:users[2].id});
 assert.equal(first.status(),200,'Verified superadmin A may request recovery');
 const requested=await first.json();
 // Invalid backup-key proof cannot consume the request or revoke credentials.
 const wrongProof=await postFrom(B.ctx,
   '/api/admin/mfa/recovery/'+requested.requestId+'/approve',
   {recoveryKey:randomBytes(32).toString('base64url')});
 assert.equal(wrongProof.status(),409,'Wrong recovery proof cannot approve a request');
 const intact=await prisma.adminMfaRecoveryRequest.findUnique({where:{id:requested.requestId}});
 assert.equal(intact?.fulfilledAt,null,'Wrong recovery proof must roll back approval');
 assert.ok(await prisma.adminMfaTotp.findUnique({where:{userId:users[2].id}}),
   'Wrong recovery proof must not revoke live authenticator');

 const unknownRecovery=await postFrom(B.ctx,'/api/admin/mfa/recovery/does-not-exist/approve',{});
 assert.ok([400,404,409,429].includes(unknownRecovery.status()),'Unknown recovery request must fail closed');
 const self=await postFrom(A.ctx,
   '/api/admin/mfa/recovery/'+requested.requestId+'/approve',{});
 assert.equal(self.status(),409,'First approver cannot approve their own request');
 const approved=await postFrom(B.ctx,
   '/api/admin/mfa/recovery/'+requested.requestId+'/approve',
   {recoveryKey:confirmation.recoveryKey});
 assert.equal(approved.status(),200,'Different verified superadmin B can approve');
 const recovery=await approved.json();
 const consumedKey=await prisma.adminMfaRecoveryCode.findUnique({where:{userId:users[2].id}});
 assert.ok(consumedKey?.usedAt,'Recovery proof must be consumed atomically');
 const oldSession=await totpAdmin.ctx.request.get('/api/admin/reports');
 assert.ok([401,403].includes(oldSession.status()),
   'Recovered administrator existing session must lose access');
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
 console.log('PASS MFA real HTTP/virtual passkey: password login, signed enrollment and assertion, step-up guard, dual approval, atomic credential revocation, one-time recovery and replacement enrollment, plus server-approved grant-free onboarding.');
}finally{
 if(browser)await browser.close();
 if(listening)await app.close();
 // Never clean up an application database; we only ever reached this code
 // after the exact disposable URL, CI flag and synthetic marker were checked.
 if(records.length)await prisma.user.deleteMany({where:{id:{in:records}}});
 if(tenantRecords.length)await prisma.employer.deleteMany({where:{id:{in:tenantRecords}}});
 await prisma.$disconnect();
}
