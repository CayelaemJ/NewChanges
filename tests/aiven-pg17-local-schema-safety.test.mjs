import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const script = readFileSync(new URL('../scripts/aiven-pg17-local-schema-test.sh', import.meta.url), 'utf8');

test('Aiven compatibility test is metadata-only and isolated', () => {
  assert.match(script, /pg_dump[^\n]*--schema-only/);
  assert.match(script, /docker run[^\n]*--network none/);
  assert.doesNotMatch(script, /--publish|\s-p\s[0-9]|\s--data-only|\s--force-reset/);
  assert.doesNotMatch(script, /DR_TARGET_DATABASE_URL|aivencloud\.com/);
});

test('Aiven compatibility trial fails closed without required PostgreSQL versions', () => {
  assert.match(script, /pg_dump --version/);
  assert.match(script, /pg_restore --version/);
  assert.match(script, /postgres:17-alpine/);
  assert.match(script, /ON_ERROR_STOP=1/);
});

test('Aiven compatibility trial rejects missing or partially restored application schema', () => {
  assert.match(script, /expected_tables/);
  assert.match(script, /expected_tables == 0/);
  assert.match(script, /tables.*expected_tables/);
});

test('Aiven compatibility trial deletes disposable local artifacts', () => {
  assert.match(script, /trap cleanup EXIT/);
  assert.match(script, /docker rm -f/);
  assert.match(script, /rm -rf "\$workdir"/);
});
