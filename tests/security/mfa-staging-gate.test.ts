import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {isMfaStagingAccessValid} from '../../src/services/mfaStagingGate.js';

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
 assert.match(boot,/dpg-dbib30142hec73cus92g-a/);
 assert.match(boot,/newchanges_mfa_synthetic_staging_db/);
 assert.match(boot,/MFA_STAGING_SYNTHETIC_ONLY/);
 assert.match(boot,/MFA_STAGING_ENFORCEMENT_APPROVED/);
 assert.match(boot,/ADMIN_MFA_ENFORCE === 'true'/);
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
 assert.match(seed,/DATABASE_URL==='postgresql:\/\/node@127\.0\.0\.1:55432\/newchanges_mfa_ephemeral'/);
});
