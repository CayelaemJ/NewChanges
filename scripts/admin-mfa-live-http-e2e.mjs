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
process.env.MFA_RP_ID='localhost';
const port=39731;
const origin='http://localhost:'+port;
process.env.MFA_EXPECTED_ORIGIN=origin;
// No MFA_STAGING_ONLY flags: this test binds to localhost and is not a Render service.
const [{app},{prisma},{hashPassword}] = await Promise.all([
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
 await item.page.goto(origin+'/mfa',{waitUntil:'domcontentloaded'});
 await item.page.locator('#enroll').waitFor();
 return item;
}
async function enroll(item,grant){
 await item.page.locator('#grant').fill(grant);
 await item.page.locator('#enroll').click();
 await item.page.waitForFunction(()=>
  (document.querySelector('#status')?.textContent||'').includes('Passkey verified for this session.'),
  null,{timeout:20000});
}
try{
 for(const user of users){
  const saved=await prisma.user.create({data:{
   email:user.email,name:user.name,role:user.role,active:true,
   createdBy:'ci-disposable-mfa-e2e',passwordHash:hashPassword(user.password),
  }});
  user.id=saved.id;records.push(saved.id);
 }
 for(const u of users.slice(0,2)){
  await prisma.adminMfaEnrollmentGrant.create({data:{
   userId:u.id,codeHash:hash(u.grant),
   expiresAt:new Date(Date.now()+15*60_000),
   approvedByOne:'ci-synthetic-first',approvedByTwo:'ci-synthetic-second',
  }});
 }
 // Simulate a credential held by the recovery target. It must be revoked by
 // the atomic recovery transaction even though it is not used to authenticate.
 const toRevoke=await prisma.adminMfaCredential.create({data:{
  userId:users[2].id,credentialId:'ci-synthetic-unused-'+nonce,
  publicKey:randomBytes(65).toString('base64url'),signCount:0n,transports:[],
 }});
 await app.listen({host:'127.0.0.1',port});
 listening=true;
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const A=await loginAndLoad(users[0]);
 const pre=await postFrom(A.ctx,'/api/admin/mfa/recovery/request',{
  targetUserId:users[2].id});
 assert.equal(pre.status(),403,'Privileged recovery must fail before passkey');
 assert.equal((await pre.json()).code,'MFA_REQUIRED','Refusal must be MFA step-up, not CSRF');
 await enroll(A,users[0].grant);
 const B=await loginAndLoad(users[1]);
 await enroll(B,users[1].grant);
 const elevated=await prisma.session.findFirst({
  where:{userId:users[0].id,endedAt:null,revokedAt:null,mfaVerifiedAt:{not:null}}
 });
 assert.ok(elevated,'Verified WebAuthn enrollment must persist MFA on an active rotated session');
 // A signed assertion after registration exercises the complete
 // verifyAuthenticationResponse path and session rotation.
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
