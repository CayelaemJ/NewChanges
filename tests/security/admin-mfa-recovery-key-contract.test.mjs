import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const routes=readFileSync('src/services/adminMfaRoutes.ts','utf8');
const schema=readFileSync('prisma/schema.prisma','utf8');
const migration=readFileSync('prisma/migrations/20261103132000_mfa_one_time_recovery_code/migration.sql','utf8');
const html=readFileSync('public/admin-mfa.html','utf8');
const js=readFileSync('public/admin-mfa.js','utf8');
test('recovery key database holds only a strong SHA-256 hash, never plaintext',()=>{
 const model=schema.match(/model AdminMfaRecoveryCode \{[\s\S]*?\n\}/)?.[0]||'';
 for(const key of ['userId','codeHash','failedAttempts','lockedUntil','usedAt'])
   assert.match(model,new RegExp('\\b'+key+'\\b'));
 assert.doesNotMatch(model,/rawKey|plainCode|secretCiphertext/);
 assert.match(migration,/CREATE TABLE "AdminMfaRecoveryCode"/);
 assert.match(migration,/CREATE UNIQUE INDEX "AdminMfaRecoveryCode_codeHash_key"/);
 assert.doesNotMatch(migration,/DROP TABLE|DELETE FROM|DROP COLUMN/i);
});
test('server generates recovery key using CSPRNG and stores only hash',()=>{
 const start=routes.indexOf('async function issueRecoveryKey(');
 const end=routes.indexOf('\ntype MfaBody=',start);
 assert.ok(start>=0 && end>start);
 const helper=routes.slice(start,end);
 assert.match(helper,/randomBytes\(32\)\.toString\('base64url'\)/);
 assert.match(helper,/codeHash:digest\(key\)/);
 assert.doesNotMatch(helper,/codeHash:key[,}]/);
 assert.match(helper,/if\(previous && !previous\.usedAt\)return null/);
});
test('recovery key is issued only after verified enrollment or fresh MFA',()=>{
 assert.match(routes,/const recoveryKey=await issueRecoveryKey\(tx,session.userId\)/);
 const start=routes.indexOf("app.post('/api/auth/mfa/recovery-key/issue'");
 assert.ok(start>=0);
 const end=routes.indexOf("app.post<{Body:MfaBody}>('/api/auth/mfa/register/options'",start);
 const section=routes.slice(start,end);
 assert.match(section,/hasFreshAdminMfa\(req,session.userId\)/);
 assert.match(section,/if\(existing && !existing\.usedAt\)return reply\.code\(409\)/);
 assert.match(section,/Cache-Control','no-store'/);
 assert.doesNotMatch(section,/return \{ok:true,recoveryKey:existing/);
});
test('browser shows key once with explicit safe-storage acknowledgment and clears display',()=>{
 for(const id of ['mfa-backup-key','mfa-backup-value','mfa-backup-confirm',
    'mfa-backup-dismiss','mfa-backup-copy'])
   assert.ok(html.includes('id="'+id+'"'),id);
 assert.match(js,/displayRecoveryKey\(result\.recoveryKey\)/);
 assert.match(js,/mfa-backup-dismiss/);
 assert.match(js,/mfa-backup-value'\)\.textContent=''/);
 assert.doesNotMatch(js,/localStorage\.(setItem|getItem)\([^\n]*recoveryKey/);
 assert.doesNotMatch(js,/sessionStorage\.(setItem|getItem)\([^\n]*recoveryKey/);
});

test('existing two-superadmin credential recovery may consume a saved key only once',()=>{
 const anchor="app.post<{Params:{id:string};Body:{recoveryKey?:string}}>('/api/admin/mfa/recovery/:id/approve'";
 const i=routes.indexOf(anchor);
 assert.ok(i>=0);
 const recovery=routes.slice(i);
 assert.match(recovery,/session\.user\.role!=='SUPERADMIN'/);
 assert.match(recovery,/hasFreshAdminMfa\(req,session\.userId,'PASSKEY'\)/);
 assert.match(recovery,/request\.requestedById===session\.userId/);
 assert.match(recovery,/codeHash:digest\(key\),usedAt:null/);
 assert.match(recovery,/data:\{usedAt:now\}/);
 assert.match(recovery,/tx\.adminMfaCredential\.updateMany/);
 assert.match(recovery,/tx\.session\.updateMany/);
 assert.doesNotMatch(recovery,/detail:\{[^}]*recoveryKey/);
});
test('recovery re-enrollment rotates consumed key but does not leak an existing key',()=>{
 const start=routes.indexOf('async function issueRecoveryKey(');
 const end=routes.indexOf('\ntype MfaBody=',start);
 const body=routes.slice(start,end);
 assert.match(body,/if\(previous && !previous\.usedAt\)return null/);
 assert.match(body,/where:\{id:previous\.id\}/);
 assert.match(body,/data:\{codeHash:digest\(key\),usedAt:null/);
});

test('previously enrolled superadmins cannot skip one-time recovery-key issuance',()=>{
 const server=readFileSync('src/server.ts','utf8');
 assert.match(server,/hasIssuedAdminRecoveryKey/);
 assert.match(server,/user\.role === "SUPERADMIN"/);
 assert.match(server,/return reply\.redirect\("\/mfa"\)/);
 assert.match(js,/mfa-existing-recovery-issue/);
 assert.match(js,/hasRecoveryKey/);
 assert.match(js,/recovery-key\/issue/);
 assert.match(html,/id="mfa-existing-recovery-key"/);
 assert.match(js,/mfa-continue'\)\.hidden/);
});
