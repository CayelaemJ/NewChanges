import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const schema=readFileSync('prisma/schema.prisma','utf8');
const source=readFileSync('src/services/adminMfaRoutes.ts','utf8');
const migration=readFileSync(
 'prisma/migrations/20261103123000_mfa_server_managed_enrollment/migration.sql','utf8');
const html=readFileSync('public/admin-mfa.html','utf8');
const browser=readFileSync('public/admin-mfa.js','utf8');

function scope(start,end) {
 const index=source.indexOf(start);
 assert.ok(index>=0,'Missing route '+start);
 const stop=end?source.indexOf(end,index+start.length):-1;
 return source.slice(index,stop>=0?stop:undefined);
}

test('server persists session-scoped authorization, not raw enrollment codes',()=>{
 const model=schema.match(/model AdminMfaEnrollmentRequest \{[\s\S]*?\n\}/)?.[0]||'';
 for(const field of ['userId','sessionId','expiresAt','approvedByOne','approvedByTwo','consumedAt'])
  assert.match(model,new RegExp('\\b'+field+'\\b'));
 assert.doesNotMatch(model,/codeHash|grantCode|secretCiphertext/);
 assert.match(migration,/CREATE TABLE "AdminMfaEnrollmentRequest"/);
 assert.match(migration,/FOREIGN KEY \("userId"\) REFERENCES "User"/);
 assert.doesNotMatch(migration,/DROP TABLE|DROP COLUMN|DELETE FROM/i);
});

test('request is tied to signed in user and active session and refuses existing MFA',()=>{
 const route=scope("app.post('/api/auth/mfa/enrollment/request'","app.get('/api/auth/mfa/enrollment/status'");
 for(const text of ['await adminSession(req,reply)','session.userId','session.id',
   'prisma.adminMfaCredential.count','prisma.adminMfaTotp.findUnique',
   'prisma.adminMfaEnrollmentRequest.findFirst','tx.adminAuditLog.create'])
  assert.ok(route.includes(text),'Missing '+text);
 assert.match(route,/if\(factors\[0\] \|\| factors\[1\]\?\.enabledAt\)/);
});

test('two independently passkey verified superadmins must approve outside user session',()=>{
 const route=scope("'/api/admin/mfa/enrollment/:id/approve'","app.get('/api/auth/mfa/status'");
 for(const text of ["session.user.role!=='SUPERADMIN'","hasFreshAdminMfa(req,session.userId,'PASSKEY')",
    'identityConfirmed!==true','request.userId===session.userId',
    'request.approvedByOne===session.userId','request.approvedByTwo',
    'targetSession.revokedAt','targetSession.expiresAt<=now',
    'claimed.count!==1','tx.adminAuditLog.create'])
  assert.ok(route.includes(text),'Missing '+text);
 assert.match(route,/approvedByOne:session\.userId/);
 assert.match(route,/approvedByTwo:session\.userId/);
 assert.doesNotMatch(route,/return \{[^}]*grantCode/);
});

test('first-time admins may enroll with password; approved recovery authorization remains single use',()=>{
 const auth=scope('async function hasEnrollmentApproval','async function recordChallenge');
 for(const text of ['sessionId:session.id','userId:session.userId','consumedAt:null',
   'expiresAt:{gt:new Date()}','consumedAt:now','used.count!==1'])
  assert.ok(auth.includes(text),'Missing '+text);
 assert.match(source,/await consumeEnrollmentApproval\(tx,session,now,body\.grantCode,/);
 assert.match(source,/await consumeEnrollmentApproval\(tx,session,now,req\.body\?\.grantCode,/);
 assert.match(auth,/passkeyCount===0 && !totp\?\.enabledAt && passwordValid/);
});

test('all accounts can enroll with password; regular accounts recover with password plus one-time key',()=>{
 const auth=scope('async function isAuthorizedToEnroll','async function consumeEnrollmentApproval');
 assert.match(auth,/passwordValid/);
 assert.match(auth,/verifyPassword\(password,session\.user\.passwordHash\)/);
 const recovery=scope("'/api/auth/mfa/recovery/self'","app.post<{Body:MfaBody}>('/api/auth/mfa/register/options'");
 for(const text of ["['ADMIN','SUPERADMIN'].includes(session.user.role)",'verifyPassword(password,session.user.passwordHash)',
   'timingSafeEqual','attempts>=5','tx.adminMfaCredential.updateMany',
   'tx.adminMfaTotp.deleteMany','tx.session.updateMany','tx.adminAuditLog.create'])
  assert.ok(recovery.includes(text),'Missing '+text);
 assert.match(html,/id="mfa-self-enroll-form"/);
 assert.match(html,/id="mfa-self-recovery"/);
 assert.match(browser,/api\('recovery\/self'/);
});

test('client exposes optional recovery approval and password-based initial enrollment',()=>{
 for(const id of ['mfa-approval-panel','mfa-approval-request','mfa-approval-admin',
   'mfa-approval-id','mfa-approval-confirm-identity'])
  assert.ok(html.includes('id="'+id+'"'),'Missing '+id);
 assert.match(browser,/Confirm your current password below/);
 assert.match(browser,/identityConfirmed:true/);
 assert.match(browser,/enrollmentApproved/);
 assert.doesNotMatch(browser,/localStorage\.setItem\([^\n]*grantCode/);
});
