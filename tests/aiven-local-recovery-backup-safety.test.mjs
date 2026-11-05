import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
const path = new URL('../scripts/aiven-local-recovery-backup.sh', import.meta.url);
const script = readFileSync(path, 'utf8');

test('recovery backup is a no-op by default', () => {
  const r = spawnSync('bash', [path.pathname], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /NO-OP/);
});
test('backup requires explicit consent and source verification', () => {
  assert.match(script, /DR_LOCAL_BACKUP_APPROVED/);
  assert.match(script, /unexpected source identity/);
  assert.match(script, /DR_SOURCE_DATABASE_URL/);
  assert.doesNotMatch(script, /DR_TARGET_DATABASE_URL|avn service|aivencloud\.com/);
});
test('backup is full-source, permission-restricted and outside the repo', () => {
  assert.match(script, /pg_dump --dbname/);
  assert.match(script, /--format=custom --compress=6/);
  assert.match(script, /umask 077/);
  assert.match(script, /chmod 600/);
  assert.match(script, /pg_restore --list/);
  assert.match(script, /SHA256/);
  assert.match(script, /trap cleanup EXIT/);
  assert.doesNotMatch(script, /--schema=public|--exclude-extension/);
  assert.doesNotMatch(script, /DROP DATABASE|DROP SCHEMA|rm -rf/);
});
test('Bash syntax is valid', () => {
  const r = spawnSync('bash', ['-n', path.pathname], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});
