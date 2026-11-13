import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const script=readFileSync('scripts/mfa-bootstrap-initial-superadmins.mjs','utf8');
const server=readFileSync('src/server.ts','utf8');
const routes=readFileSync('src/services/adminMfaRoutes.ts','utf8');
test('initial two-superadmin bootstrap is manual, private terminal only and never automatic',()=>{
 assert.match(script,/process\.stdin\.isTTY/);
 assert.match(script,/process\.stdout\.isTTY/);
 assert.match(script,/process\.env\.CI/);
 assert.match(script,/INITIAL_TWO_SUPERADMINS_ONLY/);
 assert.doesNotMatch(server,/mfa-bootstrap-initial-superadmins/);
});
test('bootstrap requires two different real superadmins and distinct operator attestations',()=>{
 assert.match(script,/emails\[0\]===emails\[1\]/);
 assert.match(script,/approvals\[0\]===approvals\[1\]/);
 assert.match(script,/role:'SUPERADMIN',active:true/);
 assert.match(script,/targets\.length!==2/);
 assert.match(script,/some\(x=>!x\.passwordHash\)/);
});
test('bootstrap refuses to run if active superadmin MFA already exists',()=>{
 assert.match(script,/tx\.adminMfaCredential\.count/);
 assert.match(script,/tx\.adminMfaTotp\.count/);
 assert.match(script,/if\(passkeys \|\| totp\)/);
 assert.match(script,/Unexpired bootstrap grants already exist/);
});
test('bootstrap emits distinct 256-bit one-time grants and persists only hashes in a transaction',()=>{
 assert.match(script,/randomBytes\(32\)\.toString\('base64url'\)/);
 assert.match(script,/tx\.adminMfaEnrollmentGrant\.create/);
 assert.match(script,/codeHash:hash\(values\[i\]\)/);
 assert.match(script,/ttlMs=10\*60_000/);
 assert.match(script,/await prisma\.\$transaction/);
 assert.match(script,/tx\.adminAuditLog\.create/);
 assert.doesNotMatch(script,/codeHash:values\[i\]/);
});
test('first-time account enrollment needs no second superadmin; approved recovery grants remain supported',()=>{
 assert.match(routes,/await consumeEnrollmentApproval\(tx,session,now,body\.grantCode,/);
 assert.match(routes,/await consumeEnrollmentApproval\(tx,session,now,req\.body\?\.grantCode,/);
 assert.match(routes,/passkeyCount===0 && !totp\?\.enabledAt && passwordValid/);
 assert.match(routes,/const recoveryKey=await issueRecoveryKey\(tx,session\.userId\)/);
});
