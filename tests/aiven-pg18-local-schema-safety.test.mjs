import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/aiven-pg18-local-schema-test.sh', import.meta.url), 'utf8');
const upgrade = readFileSync(new URL('../scripts/aiven-pg18-upgrade.sh', import.meta.url), 'utf8');

test('PG18 schema trial uses only isolated local PostgreSQL', () => {
  assert.match(script, /postgres:18-alpine/);
  assert.match(script, /docker run[^\n]*--network none/);
  assert.match(script, /pg_dump[^\n]*--schema-only/);
  assert.doesNotMatch(script, /DR_TARGET_DATABASE_URL|--publish|--force-reset/);
});

test('PG18 schema trial excludes vendor extensions and verifies table completeness', () => {
  assert.match(script, /--exclude-extension=pg_session_jwt/);
  assert.match(script, /--exclude-extension=pg_stat_statements/);
  assert.match(script, /expected_tables/);
  assert.match(script, /tables.*expected_tables/);
  assert.match(script, /ON_ERROR_STOP=1/);
});

test('PG18 schema trial always removes disposable environment', () => {
  assert.match(script, /trap cleanup EXIT/);
  assert.match(script, /docker rm -f/);
  assert.match(script, /rm -rf "\$workdir"/);
});


test('Aiven PG18 upgrade requires a successful, matching compatibility task and explicit confirmation', () => {
  assert.match(upgrade, /AIVEN_PG18_CHECK_TASK_ID/);
  assert.match(upgrade, /avn service task-get --task-id/);
  assert.match(upgrade, /task\.get\("success"\) is not True/);
  assert.match(upgrade, /create_time/);
  assert.match(upgrade, /age > 3600/);
  assert.match(upgrade, /upgrade_check/);
  assert.match(upgrade, /AIVEN_PG18_UPGRADE_APPROVED/);
  assert.match(upgrade, /UPGRADE-EXISTING-FREE/);
  assert.match(upgrade, /avn service update .*pg_version=/);
  assert.doesNotMatch(upgrade, /--plan|--cloud/);
});


test('portable dump scopes to public application schema, not Neon-managed auth', () => {
  assert.match(script, /--schema=public/);
  assert.match(script, /--exclude-extension=pg_session_jwt/);
});
