import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const script = readFileSync(new URL('../scripts/aiven-stream-snapshot.sh', import.meta.url), 'utf8');

test('snapshot copy never starts without the execute flag and separate approvals', () => {
  assert.match(script, /--execute/);
  for (const approval of [
    'AIVEN_SOURCE_CONFIRMED',
    'AIVEN_FREE_PLAN_VERIFIED',
    'AIVEN_DISK_HEADROOM_VERIFIED',
    'AIVEN_BACKUP_VERIFIED',
    'AIVEN_EXTENSION_REVIEWED',
    'AIVEN_CROSS_BORDER_APPROVED',
    'AIVEN_WRITES_FROZEN',
    'AIVEN_SNAPSHOT_COPY_APPROVED',
  ]) assert.ok(script.includes('require_approval ' + approval), approval);
});

test('source and destination identity, major version and capacity are gated', () => {
  assert.match(script, /the-fixer-postgres-cay-bed7\.b\.aivencloud\.com/);
  assert.match(script, /newchanges/);
  assert.match(script, /source_version.*target_version|target_version.*source_version/);
  assert.match(script, /700000000/);
  assert.match(script, /target_tables.*0/);
  assert.match(script, /target_views.*0/);
  assert.match(script, /target_bytes.*50000000/);
});

test('snapshot streams exactly once without destructive operations or dumps on disk', () => {
  assert.match(script, /pg_dump[\s\S]*\|[\s\S]*pg_restore/);
  assert.match(script, /--format=custom/);
  assert.match(script, /--exclude-extension=pg_session_jwt/);
  assert.match(script, /--exit-on-error/);
  assert.match(script, /--single-transaction/);
  assert.doesNotMatch(script, /--clean|--force-reset|DROP DATABASE|CREATE DATABASE|while true|--jobs=/);
  assert.doesNotMatch(script, /AVNS_[A-Za-z0-9]+|postgres:\/\/avnadmin:/);
});

test('copy validates table and row counts and never switches application traffic', () => {
  assert.match(script, /restored_tables/);
  assert.match(script, /ROW COUNT MISMATCH/);
  assert.match(script, /tables_to_check="\$\(sql DR_SOURCE_DATABASE_URL/);
  assert.match(script, /checked.*source_tables/);
  assert.doesNotMatch(script, /done < <\(sql DR_SOURCE_DATABASE_URL/);
  assert.doesNotMatch(script, /render deploy|trigger_deploy|update_environment_variables/);
});


test('default invocation has no network or database prerequisites', () => {
  const result = spawnSync('bash', ['scripts/aiven-stream-snapshot.sh'], {
    cwd: new URL('..', import.meta.url),
    env: { PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /NO-OP/);
});

test('explicit execution fails before any connection without operator approvals', () => {
  const result = spawnSync('bash', ['scripts/aiven-stream-snapshot.sh', '--execute'], {
    cwd: new URL('..', import.meta.url),
    env: { PATH: process.env.PATH ?? '' },
    encoding: 'utf8',
    timeout: 5000,
  });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /AIVEN_SOURCE_CONFIRMED/);
});


test('portable dump scopes to public application schema, not Neon-managed auth', () => {
  assert.match(script, /--schema=public/);
  assert.match(script, /--exclude-extension=pg_session_jwt/);
});
