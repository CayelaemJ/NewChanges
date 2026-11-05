import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = new URL('../scripts/aiven-pg18-upgrade.sh', import.meta.url).pathname;

function runWithService(plan, region = 'do-blr') {
  const dir = mkdtempSync(join(tmpdir(), 'aiven-upgrade-offline-'));
  try {
    const fakeAiven = join(dir, 'avn');
    const service = JSON.stringify({
      service_name: 'the-fixer-postgres',
      service_type: 'pg',
      plan,
      cloud_name: region,
      state: 'RUNNING',
      metadata: { pg_version: '17.11' },
      disk_space_mb: 1024,
    });
    writeFileSync(fakeAiven, [
      '#!/bin/sh',
      'if [ "$1" = service ] && [ "$2" = get ]; then',
      "  printf '%s\\n' '" + service + "'",
      '  exit 0',
      'fi',
      'echo "Unexpected Aiven command" >&2',
      'exit 71',
      '',
    ].join('\n'));
    chmodSync(fakeAiven, 0o700);
    return spawnSync('bash', [script, '--check'], {
      env: { ...process.env, PATH: dir + ':' + (process.env.PATH || '') },
      encoding: 'utf8',
      timeout: 10000,
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Aiven helper refuses paid plan before creating upgrade-check task', () => {
  const result = runWithService('developer');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /free-1-1gb/);
});

test('Aiven helper refuses wrong region before creating upgrade-check task', () => {
  const result = runWithService('free-1-1gb', 'aws-eu-west-1');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /do-blr/);
});

test('Aiven helper does nothing by default', () => {
  const result = spawnSync('bash', [script], {
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Aiven PostgreSQL 18 version alignment/);
});
