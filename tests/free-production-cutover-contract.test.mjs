import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const blueprint = read('render.free-production.yaml');
const worker = read('wrangler.newchanges-free.jsonc');

test('direct production backend uses Free Docker and never auto deploys', () => {
  assert.match(blueprint, /name: newchanges-free-production/);
  assert.match(blueprint, /plan: free/);
  assert.match(blueprint, /runtime: docker/);
  assert.match(blueprint, /autoDeployTrigger: off/);
  assert.match(blueprint, /healthCheckPath: \/health/);
  assert.doesNotMatch(blueprint, /healthCheckPath: \/ready/);
});
test('production candidate remains non-writing before a separately verified cutover', () => {
  assert.match(blueprint, /STANDBY_MODE\n\s+value: "true"/);
  assert.match(blueprint, /TRAFFIC_SAVER_MODE\n\s+value: "true"/);
  assert.match(blueprint, /ENABLE_AUTHORITATIVE_INCREMENTAL_SCHEDULER\n\s+value: "false"/);
  assert.match(blueprint, /NEWCHANGES_EDGE_ORIGIN_GUARD_ENABLED\n\s+value: "true"/);
  assert.match(blueprint, /COOKIE_SECURE\n\s+value: "true"/);
});
test('database URL and edge secret must be manually provisioned, not committed', () => {
  for (const key of ['DATABASE_URL', 'NEWCHANGES_EDGE_ORIGIN_SHARED_SECRET', 'PUBLIC_BASE_URL']) {
    assert.match(blueprint, new RegExp('- key: ' + key + '\\n\\s+sync: false'));
  }
  assert.doesNotMatch(blueprint, /postgres(?:ql)?:\/\//);
  const config = JSON.parse(worker);
  assert.equal(config.vars.NEWCHANGES_FREE_EDGE_ENABLED, 'false');
  assert.equal(config.workers_dev, false);
  assert.equal('routes' in config, false);
});

test('Cloudflare uses the deployed Render origin, not a second database client', () => {
  const cfg=JSON.parse(worker);
  assert.equal(cfg.vars.NEWCHANGES_RENDER_ORIGIN,'https://newchanges-free-production.onrender.com');
  assert.equal(cfg.vars.NEWCHANGES_FREE_EDGE_ENABLED,'false');
  const edge=read('cloudflare/free-edge/worker.mjs');
  assert.match(edge,/fetch\(upstreamRequest/);
  assert.match(edge,/X-NewChanges-Edge-Token/);
  assert.doesNotMatch(edge,/DATABASE_URL|PGPASSWORD|Hyperdrive|connectionString/);
  assert.doesNotMatch(worker,/DATABASE_URL|postgres(?:ql)?:\/\//);
});
test('Render backend connects to Aiven only via private runtime URL and one bounded pool', () => {
  const database=read('src/services/database.ts');
  assert.match(database,/process\.env\.DATABASE_URL/);
  assert.match(database,/new PrismaPg/);
  assert.match(database,/connection_limit/);
  assert.match(blueprint,/DATABASE_URL\n\s+sync: false/);
});
