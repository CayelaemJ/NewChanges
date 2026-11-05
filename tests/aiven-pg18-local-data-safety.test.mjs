import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const path = new URL('../scripts/aiven-pg18-local-data-test.sh', import.meta.url);
const script = readFileSync(path, 'utf8');

test('full-data trial does nothing without --execute', () => {
  const result = spawnSync('bash', [path.pathname], {
    encoding: 'utf8', env: { PATH: process.env.PATH ?? '' }, timeout: 5000,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /NO-OP/);
});
test('full-data trial requires separate explicit approval', () => {
  assert.match(script, /AIVEN_LOCAL_DATA_TRIAL_APPROVED/);
  assert.match(script, /DR_SOURCE_DATABASE_URL/);
  assert.match(script, /source is not the expected Neon/);
  assert.doesNotMatch(script, /DR_TARGET_DATABASE_URL|aivencloud\.com|render deploy/);
});
test('full-data trial snapshots only public and excludes vendor extensions', () => {
  assert.match(script, /--schema=public/);
  assert.match(script, /--exclude-extension=pg_session_jwt/);
  assert.match(script, /--exclude-extension=pg_stat_statements/);
  assert.match(script, /--format=custom/);
  assert.match(script, /--single-transaction/);
  assert.match(script, /--exit-on-error/);
});
test('restore stays inside isolated disposable Docker and securely cleans up', () => {
  assert.match(script, /docker run --detach --rm --network none/);
  assert.match(script, /docker exec -i "\$cid" pg_restore/);
  assert.match(script, /docker rm -f "\$cid"/);
  assert.match(script, /trap cleanup EXIT/);
  assert.match(script, /rm -rf -- "\$workdir"/);
  assert.doesNotMatch(script, /--publish|--network host|--force-reset/);
});
test('trial validates all tables and sizes and detects count drift', () => {
  assert.match(script, /expected_tables/);
  assert.match(script, /restored_tables/);
  assert.match(script, /mismatches/);
  assert.match(script, /pg_database_size\(current_database\(\)\)/);
  assert.match(script, /archive_bytes/);
});
test('trial Bash syntax parses', () => {
  const result = spawnSync('bash', ['-n', path.pathname], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
