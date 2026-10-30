import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const schema=readFileSync('prisma/schema.prisma','utf8');
const routes=readFileSync('src/services/adminMfaRoutes.ts','utf8');
const migration=readFileSync(
 'prisma/migrations/20261030153000_admin_mfa_recovery_approvals/migration.sql','utf8');

test('recovery requests persist distinct initiator, approver and target ownership',()=>{
 assert.match(schema,/model AdminMfaRecoveryRequest \{/);
 for (const field of ['targetUserId','requestedById','approvedById','expiresAt','fulfilledAt'])
  assert.match(schema,new RegExp('\\b'+field+'\\b'));
 assert.match(migration,/CREATE TABLE "AdminMfaRecoveryRequest"/);
 assert.match(migration,/REFERENCES "User"/);
});
test('both phases require a passkey-verified superadmin',()=>{
 assert.match(routes,/\/api\/admin\/mfa\/recovery\/request/);
 assert.match(routes,/\/api\/admin\/mfa\/recovery\/:id\/approve/);
 const guard = "session.user.role!=='SUPERADMIN' || !await hasFreshAdminMfa(req,session.userId)";
 assert.equal(routes.split(guard).length-1,2);
});
test('prevents target self-approval, single-approver bypass and stale recovery',()=>{
 assert.match(routes,/targetUserId===session.userId/);
 assert.match(routes,/request.requestedById===session.userId/);
 assert.match(routes,/request.targetUserId===session.userId/);
 assert.match(routes,/request.expiresAt<=now/);
 assert.match(routes,/approvedById:null,fulfilledAt:null/);
 assert.match(routes,/claimed.count!==1/);
});
test('atomic successful recovery revokes existing credentials, sessions, challenges and grants',()=>{
 const start=routes.indexOf("app.post<{Params:{id:string}}>('/api/admin/mfa/recovery/:id/approve'");
 assert.ok(start>=0);
 const section=routes.slice(start);
 for(const needle of [
 'await prisma.$transaction','tx.adminMfaCredential.updateMany',
 'tx.session.updateMany','tx.adminMfaChallenge.deleteMany',
 'tx.adminMfaEnrollmentGrant.updateMany','tx.adminMfaEnrollmentGrant.create',
 'tx.adminAuditLog.create']) assert.ok(section.includes(needle),needle);
 assert.match(section,/codeHash:digest\(grantCode\)/);
 assert.doesNotMatch(section,/detail:\{[^}]*grantCode/);
});
