import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const text = readFileSync(new URL('../scripts/aiven-verify-postcopy.mjs',import.meta.url),'utf8');
test('validator is read-only and scoped to known source/target endpoints',()=>{
  assert.match(text,/\.neon\.tech\|newchanges/);
  assert.match(text,/the-fixer-postgres-cay-bed7\.b\.aivencloud\.com\|defaultdb/);
  assert.match(text,/default_transaction_read_only=on/);
  assert.doesNotMatch(text,/DROP TABLE|CREATE TABLE|INSERT INTO|UPDATE public|DELETE FROM|pg_restore|pg_dump/);
});
test('validator checks table, column, index, constraint, sequence and view structure and all counts',()=>{
  for(const category of ['tables:', 'columns:', 'indexes:', 'constraints:', 'sequences:', 'views:', 'count(*)::text']) assert.ok(text.includes(category),category);
  assert.match(text,/sourceNames\.length !== 57/);
  assert.match(text,/DataAccessEvent/);
  assert.match(text,/row_count_differences/);
});
test('validation requires both URLs and prints no full connection URLs',()=>{
  const p=spawnSync(process.execPath,[new URL('../scripts/aiven-verify-postcopy.mjs',import.meta.url).pathname],{
    env:{PATH:process.env.PATH??''}, encoding:'utf8',timeout:5000
  });
  assert.equal(p.status,2);
  assert.match(p.stderr,/BLOCKED/);
});
test('node parses validator',()=>{
  const p=spawnSync(process.execPath,['--check',new URL('../scripts/aiven-verify-postcopy.mjs',import.meta.url).pathname],{encoding:'utf8'});
  assert.equal(p.status,0,p.stderr);
});

test('connection URI is split into libpq settings without passing the password in argv',()=>{
  assert.match(text,/env\.PGDATABASE = decodeURIComponent\(u\.pathname\.slice\(1\)\)/);
  assert.match(text,/env\.PGPASSWORD = decodeURIComponent\(u\.password\)/);
  assert.match(text,/PGCHANNELBINDING/);
  assert.match(text,/spawnSync\('psql'/);
  assert.match(text,/\['-w', '-X'/);
  assert.match(text,/table count '/);
  assert.match(text,/authentication failed/);
});
