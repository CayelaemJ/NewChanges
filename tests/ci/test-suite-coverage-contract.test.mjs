import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');
test('mandatory Docker suite preserves comprehensive test groups',()=>{
 const suite=read('scripts/ci/run-docker-ci-suite.sh');
 for(const required of [
  'network-isolation-ci.mjs','adversarial-import-inputs.test.ts',
  'ingestion-faults.test.ts','route-authorization-inventory-ci.mjs',
  'database-resilience-ci.mjs','import-failure-integration-ci.mjs',
  'admin-mfa-live-http-e2e.mjs','local-http-load-ci.mjs',
  'visual-regression-ci.mjs','quality:lint','quality:types','quality:unit',
  'quality:e2e','check:security','check:accessibility','check:performance',
  'check:source-sync-safety','check:source-reconciliation',
  'rls-isolation-ci-probe.mjs','prisma-upgrade-integration.mjs'
 ]){
  assert.ok(suite.includes(required),'Missing release gate: '+required);
 }
});
test('all release work stays on dedicated manual self-hosted runner',()=>{
 const workflow=read('.github/workflows/newchanges-manual-docker-ci.yml');
 for(const required of [
  'workflow_dispatch:', 'runs-on: [self-hosted, linux, x64, newchanges-ci]',
  'migrate deploy','migrate status','pg_dump','pg_restore',
  'run-security-scanners.sh','scan','Extract isolated Docker test evidence',
  'down --volumes --remove-orphans','persist-credentials: false'
 ])assert.ok(workflow.includes(required),'Missing workflow release gate: '+required);
 assert.doesNotMatch(workflow,/^\s+push:|^\s+pull_request:/m,
  'Do not execute unreviewed branches on privileged local runner');
 assert.doesNotMatch(workflow,/\bruns-on:\s*ubuntu-latest\b/);
});
test('all database-changing integration suites have hard disposable URL guards',()=>{
 for(const path of [
  'scripts/ci/database-resilience-ci.mjs',
  'scripts/ci/import-failure-integration-ci.mjs',
  'scripts/ci/local-http-load-ci.mjs',
  'scripts/admin-mfa-live-http-e2e.mjs'
 ]){
  const script=read(path);
  assert.ok(script.includes('newchanges_ci'),'Missing disposable DB identity guard: '+path);
  assert.ok(script.includes('CI_RLS_PROBE_APPROVED'),
    'Missing synthetic CI opt-in guard: '+path);
 }
});
test('approved MFA design contract is present and versioned',()=>{
 const contract=JSON.parse(read('tests/visual-baselines/mfa-design-contract.json'));
 assert.deepEqual(contract.breakpoints,[320,390,768,1366]);
 assert.ok(contract.requiredElements.includes('#mfa-backup-key'));
 assert.ok(contract.headerBackground.includes('rgb('));
});
