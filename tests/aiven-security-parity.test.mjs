import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const path=new URL('../scripts/aiven-security-parity.mjs',import.meta.url).pathname;
const src=readFileSync(path,'utf8');
test('security parity command parses and rejects no-credential run',()=>{
 const check=spawnSync(process.execPath,['--check',path],{encoding:'utf8'});
 assert.equal(check.status,0,check.stderr);
 const r=spawnSync(process.execPath,[path],{
  encoding:'utf8',timeout:10000,env:{PATH:process.env.PATH||''}
 });
 assert.equal(r.status,2,r.stderr);
 assert.match(r.stderr,/BLOCKED: Missing source private database URL/);
});
test('security metadata comparison uses read-only transaction and endpoint pinning',()=>{
 assert.match(src,/BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY/);
 assert.match(src,/default_transaction_read_only=on/);
 assert.match(src,/\.neon\.tech/);
 assert.match(src,/the-fixer-postgres-cay-bed7\.b\.aivencloud\.com/);
 assert.match(src,/57/);
 assert.match(src,/pg_policies/);
 assert.match(src,/pg_get_triggerdef/);
 assert.match(src,/pg_get_functiondef/);
 assert.match(src,/relrowsecurity/);
 assert.match(src,/relforcerowsecurity/);
 assert.doesNotMatch(src,/\bINSERT INTO\b|\bUPDATE public\b|\bDELETE FROM\b|\bDROP TABLE\b/);
});
test('reported parity output contains only counts and status, not definitions',()=>{
 assert.match(src,/SECURITY PARITY SUMMARY:/);
 assert.match(src,/different_definitions/);
 assert.match(src,/SCOPE: metadata only/);
 assert.doesNotMatch(src,/console\.log\(.*PGPASSWORD/);
});
