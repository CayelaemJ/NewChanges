import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/aiven-pg18-local-schema-test.sh', import.meta.url), 'utf8');

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
