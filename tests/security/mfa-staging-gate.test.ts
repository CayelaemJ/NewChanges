import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isMfaStagingAccessValid} from '../../src/services/mfaStagingGate.js';
import {isApprovedManagedStagingUrl,approvedStagingDatabaseEnvironment,EPHEMERAL_STAGING_URL,RENDER_STAGING_DB_ID,RENDER_STAGING_DB_NAME} from '../../scripts/mfa-staging-db-target.mjs';

const pass='fake-synthetic-staging-password-long-enough';
const valid='Basic '+Buffer.from('mfa-staging:'+pass).toString('base64');
test('isolated MFA staging requires a valid independent Basic password',()=>{
 assert.equal(isMfaStagingAccessValid(valid,pass),true);
 for (const header of [undefined,'', 'Bearer something','Basic garbage',
  'Basic '+Buffer.from('other-user:'+pass).toString('base64'),
  'Basic '+Buffer.from('mfa-staging:incorrect').toString('base64')])
   assert.equal(isMfaStagingAccessValid(header,pass),false);
 assert.equal(isMfaStagingAccessValid(valid,undefined),false);
 assert.equal(isMfaStagingAccessValid(valid,'short'),false);
});
test('MFA staging uses unique Docker entrypoint and exact synthetic-only database',()=>{
 const f=readFileSync('Dockerfile.mfa-staging','utf8');
 const boot=readFileSync('scripts/render-mfa-staging-boot.mjs','utf8');
 const server=readFileSync('src/server.ts','utf8');
 assert.match(f,/CMD \["node", "scripts\/render-mfa-staging-boot\.mjs"\]/);
 const target=readFileSync('scripts/mfa-staging-db-target.mjs','utf8');
 assert.match(target,/dpg-dbib30142hec73cus92g-a/);
 assert.match(target,/newchanges_mfa_synthetic_staging_db/);
 assert.match(boot,/approvedStagingDatabaseEnvironment/);
 assert.match(boot,/MFA_STAGING_SYNTHETIC_ONLY/);
 assert.match(boot,/MFA_STAGING_ENFORCEMENT_APPROVED/);
 assert.match(boot,/ADMIN_MFA_ENFORCE\s*===\s*'true'/);
 assert.match(boot,/DATABASE_URL/);
 assert.match(boot,/run\('node',\['node_modules\/prisma\/build\/index\.js','db','push'\]\)/);
 assert.match(boot,/MFA_STAGING_LOCAL_EPHEMERAL_DB/);
 assert.match(boot,/!process\.env\.DATABASE_URL/);
 assert.match(boot,/127\.0\.0\.1/);
 assert.match(boot,/newchanges_mfa_ephemeral/);
 assert.match(boot,/listen_addresses=127\.0\.0\.1/);
 assert.doesNotMatch(boot,/spawnSync\([^\n]+--(?:accept-data-loss|force-reset)/);
 assert.match(boot,/MFA_STAGING_BOOTSTRAP_FIXTURES/);
 assert.match(server,/isMfaStagingAccessValid\(req\.headers\.authorization/);
 const seed=readFileSync('scripts/mfa-staging-seed.mjs','utf8');
 assert.match(seed,/approvedStagingDatabaseEnvironment\(process\.env\)/);
 assert.match(seed,/mfa-recovery-target@example\.invalid/);
 assert.match(seed,/role:'ADMIN'/);
 assert.match(seed,/new Set\(passwords\)\.size!==3/);
 assert.match(seed,/MFA_STAGING_ENFORCEMENT_APPROVED/);
});

test('managed staging DB is exact, private-network only and mutually exclusive with local mode',()=>{
 const managed='postgresql://synthetic_user:dummy-not-a-secret@'+RENDER_STAGING_DB_ID+
  '.frankfurt-postgres.render.com:5432/'+RENDER_STAGING_DB_NAME;
 assert.equal(isApprovedManagedStagingUrl(managed),true);
 for(const bad of [
  managed.replace(RENDER_STAGING_DB_ID,'another-db'),
  managed.replace(RENDER_STAGING_DB_NAME,'production'),
  managed.replace('postgresql://','http://'),
  managed.replace('synthetic_user:dummy-not-a-secret@',''),
  managed.replace(':5432/',':5433/'),
  managed+'?schema=not_public',
  'postgresql://example:example@127.0.0.1:5432/'+RENDER_STAGING_DB_NAME,
  managed.replace('.frankfurt-postgres.render.com','.evil.com')
 ])assert.equal(isApprovedManagedStagingUrl(bad),false);
 const env={
  MFA_STAGING_ONLY:'true',MFA_STAGING_SYNTHETIC_ONLY:'true',
  STANDBY_MODE:'true',TRAFFIC_SAVER_MODE:'true',NODE_ENV:'production',
  MFA_STAGING_LOCAL_EPHEMERAL_DB:'false',MFA_STAGING_MANAGED_DB:'true',
  DATABASE_URL:managed
 };
 assert.equal(approvedStagingDatabaseEnvironment(env),true);
 assert.equal(approvedStagingDatabaseEnvironment({...env,DATABASE_URL:EPHEMERAL_STAGING_URL}),false);
 assert.equal(approvedStagingDatabaseEnvironment({...env,STANDBY_MODE:'false'}),false);
 assert.equal(approvedStagingDatabaseEnvironment({...env,MFA_STAGING_LOCAL_EPHEMERAL_DB:'true'}),false);
 assert.equal(approvedStagingDatabaseEnvironment({...env,MFA_STAGING_MANAGED_DB:'false'}),false);
 assert.equal(approvedStagingDatabaseEnvironment({
  ...env,MFA_STAGING_LOCAL_EPHEMERAL_DB:'true',
  MFA_STAGING_MANAGED_DB:'false',
  DATABASE_URL:EPHEMERAL_STAGING_URL}),true);
});
