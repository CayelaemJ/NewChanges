import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const blueprint=readFileSync('render.mfa-staging.yaml','utf8');
test('staging Blueprint references one EXISTING managed database without defining a new one',()=>{
 assert.match(blueprint,/^services:\s*$/m);
 assert.match(blueprint,/^\s+- type: web\s*$/m);
 assert.match(blueprint,/^\s+name: newchanges-mfa-isolated-staging\s*$/m);
 assert.match(blueprint,/^\s+branch: chore\/manual-self-hosted-docker-ci-20261029\s*$/m);
 assert.match(blueprint,/^\s+dockerfilePath: \.\/Dockerfile\.mfa-staging\s*$/m);
 assert.match(blueprint,/^\s+autoDeployTrigger: off\s*$/m);
 assert.match(blueprint,/^\s+plan: free\s*$/m);
 assert.match(blueprint,/^\s+region: frankfurt\s*$/m);
 assert.match(blueprint,/^\s+healthCheckPath: \/health\s*$/m);
 assert.match(blueprint,/^\s+- key: DATABASE_URL\s*\n\s+fromDatabase:\s*\n\s+name: newchanges-mfa-synthetic-staging-db\s*\n\s+property: connectionString\s*$/m);
 assert.match(blueprint,/^\s+- key: MFA_STAGING_LOCAL_EPHEMERAL_DB\s*\n\s+value: "false"/m);
 assert.match(blueprint,/^\s+- key: MFA_STAGING_MANAGED_DB\s*\n\s+value: "true"/m);
 assert.doesNotMatch(blueprint,/^\s*databases:\s*$/m,'Do not provision duplicate Postgres');
 assert.doesNotMatch(blueprint,/^\s+name: newchanges-standby\s*$/m,'Do not manage production');
 assert.doesNotMatch(blueprint,/(?:postgresql|postgres):\/\//i,'Do not commit database URLs');
 assert.doesNotMatch(blueprint,/^\s+- key: MFA_STAGING_(?:GATE_PASSWORD|ADMIN_[AB]_(?:PASSWORD|GRANT)|TARGET_(?:PASSWORD|GRANT))\s*$/m,
  'Keep staging secrets in the already configured Render environment');
});
