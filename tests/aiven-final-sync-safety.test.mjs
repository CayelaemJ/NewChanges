import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const verifier = readFileSync(new URL('../scripts/aiven-verify-content.mjs',import.meta.url),'utf8');
const delta = readFileSync(new URL('../scripts/aiven-final-delta-sync.mjs',import.meta.url),'utf8');
const plan = readFileSync(new URL('../scripts/aiven-final-delta-plan.mjs',import.meta.url),'utf8');

for (const path of ['../scripts/aiven-verify-content.mjs','../scripts/aiven-final-delta-sync.mjs','../scripts/aiven-final-delta-plan.mjs']) {
  test('node parses '+path,()=>{
    const p=spawnSync(process.execPath,['--check',new URL(path,import.meta.url).pathname],{encoding:'utf8'});
    assert.equal(p.status,0,p.stderr);
  });
}
test('content verifier is read only and checks every application table and existing audit history',()=>{
  assert.match(verifier,/BEGIN TRANSACTION READ ONLY/);
  assert.match(verifier,/const tables = a\.filter\(x=>x !== 'DataAccessEvent'\)/);
  assert.match(verifier,/to_jsonb\(t\) - 'lastSeenAt'/);
  assert.match(verifier,/ORDER BY "createdAt", id LIMIT/);
  assert.match(verifier,/auditHistoryMatches/);
  assert.doesNotMatch(verifier,/\bDROP\b|\bTRUNCATE\b|\bINSERT INTO\b|\bUPDATE\s+public/);
});
test('final synchronization is check-only unless explicitly executed',()=>{
  assert.match(delta,/const mode=process\.argv\[2\]\|\|'--check'/);
  assert.match(delta,/AIVEN_SOURCE_WRITERS_FENCED/);
  assert.match(delta,/AIVEN_FINAL_DATA_SYNC_APPROVED/);
  assert.match(delta,/AIVEN_RECOVERY_BACKUP_VERIFIED/);
  assert.match(delta,/SYNC-AIVEN-DELTA/);
  assert.match(delta,/const before=verify\(\)/);
  assert.match(delta,/const after=verify\(\)/);
});
test('Aiven write transaction is narrowly scoped and keeps prior audit rows',()=>{
  assert.match(plan,/CREATE TEMP TABLE audit_stage/);
  assert.match(plan,/CREATE TEMP TABLE session_stage/);
  assert.match(plan,/ON CONFLICT \("id"\) DO NOTHING/);
  assert.match(plan,/FROM audit_stage WHERE true/);
  assert.match(plan,/UPDATE public\."Session" d SET "lastSeenAt"/);
  assert.match(plan,/IF EXISTS \(SELECT 1 FROM audit_stage/);
  assert.match(plan,/COMMIT;/);
  assert.doesNotMatch(plan,/DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE|db:push|db:deploy/);
});
test('driver imports the reviewed SQL plan, without generating independent write queries',()=>{
  assert.match(delta,/buildAivenDeltaSql\(audit,sessions\)/);
});
test('connection info is passed by process environment rather than in argv',()=>{
  for(const src of [verifier,delta]){
    assert.match(src,/env\.PGPASSWORD/);
    assert.match(src,/env\.PGDATABASE/);
    assert.match(src,/PGHOST/);
    assert.doesNotMatch(src,/psql'\s*,\s*\[[^\]]*DATABASE_URL/);
  }
});
test('default no-credential run stops without changing any database',()=>{
  for(const path of ['../scripts/aiven-verify-content.mjs','../scripts/aiven-final-delta-sync.mjs']){
    const result=spawnSync(process.execPath,[new URL(path,import.meta.url).pathname],{
      encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH??''}
    });
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/BLOCKED/);
  }
});

test('synthetic Docker rehearsal is isolated and never connects to production endpoints',()=>{
  const rehearsal=readFileSync(new URL('../scripts/aiven-final-delta-docker-rehearsal.mjs',import.meta.url),'utf8');
  assert.match(rehearsal,/--network','none/);
  assert.match(rehearsal,/postgres:18-alpine/);
  assert.match(rehearsal,/buildAivenDeltaSql/);
  assert.match(rehearsal,/idempotent/);
  assert.match(rehearsal,/Conflicting existing audit history must abort/);
  assert.ok(rehearsal.includes("run('docker',['rm','-f',name])"));
  assert.doesNotMatch(rehearsal,/DR_SOURCE_DATABASE_URL|DR_TARGET_DATABASE_URL|neon\.tech|the-fixer-postgres-cay/);
});
