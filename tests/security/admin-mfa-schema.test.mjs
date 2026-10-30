import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const schema=readFileSync('prisma/schema.prisma','utf8');
const migration=readFileSync('prisma/migrations/20261030101500_admin_mfa_staging/migration.sql','utf8');
test('staged MFA credential data model stores public material and counters only',()=>{
 assert.match(schema,/model AdminMfaCredential/);
 for(const f of ['credentialId','publicKey','signCount','revokedAt','userId']) assert.match(schema,new RegExp('\\b'+f+'\\b'));
 assert.doesNotMatch(schema,/totpSecret|recoveryCodePlaintext|privateKey/);
});
test('migration is additive and defines uniqueness and ownership',()=>{
 assert.match(migration,/ADD COLUMN "mfaVerifiedAt"/);
 assert.match(migration,/CREATE UNIQUE INDEX "AdminMfaCredential_credentialId_key"/);
 assert.match(migration,/FOREIGN KEY \("userId"\) REFERENCES "User"/);
 assert.doesNotMatch(migration,/DROP TABLE|DROP COLUMN|DELETE FROM/i);
});
test('session MFA timestamp starts unverified',()=>{
 const session=schema.match(/model Session \{[\s\S]*?\n\}/)?.[0]||'';
 assert.match(session,/mfaVerifiedAt\s+DateTime\?/);
 assert.doesNotMatch(session,/mfaVerifiedAt[^\n]*@default\(now\(\)\)/);
});
