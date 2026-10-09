import fs from "node:fs";
import assert from "node:assert/strict";

const read = (p) => fs.readFileSync(p, "utf8");
const schema = read("prisma/schema.prisma");
const migration = read("prisma/migrations/20260930170000_enterprise_analytics_phase_2/migration.sql");
const adapter = read("src/services/sourceAdapter.ts");
const sync = read("src/services/syncService.ts");
const server = read("src/server.ts");
const admin = read("public/admin.html");

assert.match(schema, /sourceAnalyticsReplicaHost\s+String\?/);
assert.match(schema, /sourceAnalyticsReplicaMaxLagSeconds\s+Int/);
assert.match(schema, /workloadClass\s+String/);
assert.match(schema, /useReplica\s+Boolean/);
assert.match(migration, /sourceAnalyticsReplicaEnabled/);
assert.match(migration, /AnalyticsRoute/);

assert.match(adapter, /SOURCE_SQL_REPLICA_HOST/);
assert.match(adapter, /SHOW REPLICA STATUS/);
assert.match(adapter, /SHOW SLAVE STATUS/);
assert.match(adapter, /readOnly/);
assert.match(adapter, /useReplica/);
assert.match(adapter, /sourceViewOverride/);
assert.match(adapter, /Read replica is required/);

assert.match(sync, /workloadClass/);
assert.match(sync, /useReplica/);
assert.match(sync, /sourceAnalyticsReplicaMaxLagSeconds/);
// The public sync config must strip the replica password (never return it to the client).
assert.match(sync, /sourceAnalyticsReplicaPassword,\s*\.\.\.safe/);

assert.match(server, /\/api\/admin\/integration\/replica-health/);
assert.match(server, /workloadClass/);
assert.match(server, /useReplica/);

assert.match(admin, /integ-replica-host/);
assert.match(admin, /integ-replica-lag/);
assert.match(admin, /replica-health/);
assert.match(admin, /SOURCE_SQL_REPLICA_PASSWORD/);

console.log("Enterprise analytics phase 2 regression checks passed.");
