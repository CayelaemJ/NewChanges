import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const backup = new URL('../scripts/production-encrypted-backup.mjs',import.meta.url).pathname;
const invoke=(args,env={})=>spawnSync(process.execPath,[backup,...args],{
  encoding:'utf8',env:{...process.env,...env}
});
test('no production credentials or output directory fail closed',()=>{
 const r=invoke(['source','--preflight'],{DR_SOURCE_DATABASE_URL:''});
 assert.equal(r.status,2);
 assert.match(r.stderr,/Missing source DB URL/);
});
test('cannot redirect the Neon backup to an unrelated database',()=>{
 const r=invoke(['source','--preflight'],{
  DR_SOURCE_DATABASE_URL:'postgresql://fake:fake@attacker.invalid:5432/newchanges'
 });
 assert.equal(r.status,2);
 assert.match(r.stderr,/Unexpected Neon endpoint/);
});
test('cannot back up the wrong Aiven database',()=>{
 const r=invoke(['target','--preflight'],{
  DR_TARGET_DATABASE_URL:'postgresql://fake:fake@the-fixer-postgres-cay-bed7.b.aivencloud.com:26029/other'
 });
 assert.equal(r.status,2);
 assert.match(r.stderr,/Unexpected Aiven endpoint/);
});
test('backup implementation streams through age without writing a raw dump file',()=>{
 const src=readFileSync(backup,'utf8');
 assert.match(src,/spawn\('pg_dump'/);
 assert.match(src,/spawn\('age'/);
 assert.match(src,/dump\.stdout\.pipe\(encrypt\.stdin\)/);
 assert.match(src,/encrypt\.stdout\.pipe\(destination\)/);
 assert.doesNotMatch(src,/--file[=,]/);
 assert.match(src,/rmSync\(tmp,\{force:true\}\)/);
});

test('offline restore drill cannot connect to external databases or networks',()=>{
 const script=readFileSync(new URL('../scripts/verify-encrypted-backup-restore.sh',import.meta.url),'utf8');
 assert.match(script,/--network none/);
 assert.match(script,/postgres:18-alpine/);
 assert.match(script,/pg_restore --exit-on-error/);
 assert.match(script,/set -Eeuo pipefail/);
 assert.match(script,/trap cleanup EXIT/);
 assert.match(script,/table_count.*57|table_count.*!= 57/);
});
