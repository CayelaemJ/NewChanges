import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source=readFileSync(new URL("../../src/services/sourceAdapter.ts", import.meta.url),"utf8");
const policy=readFileSync(new URL("../../src/services/sourceSqlTlsPolicy.ts", import.meta.url),"utf8");

test("PostgreSQL, MySQL and SQL Server all enforce production TLS verification", () => {
  assert.match(source,/assertSecureSourceSqlTransport\(sslEnabled, trust, "PostgreSQL source"\)/);
  assert.match(source,/assertSecureSourceSqlTransport\(sslEnabled, trust, "MySQL source"\)/);
  assert.match(source,/assertSecureSourceSqlTransport\(encrypt, trust, "SQL Server source"\)/);
  assert.match(source,/import \{ assertSecureSourceSqlTransport \} from "\.\/sourceSqlTlsPolicy\.js"/);
  assert.match(policy,/if \(environment !== "production"\) return/);
  assert.match(policy,/if \(!sslEnabled\)/);
  assert.match(policy,/if \(trustServerCertificate\)/);
});

test("read replica execution reuses the same protected connection factories", () => {
  assert.match(source,/if \(dialect === "MYSQL"\) replicaExecutor = await openMysqlExecutor\(replicaConfig\)/);
  assert.match(source,/else if \(dialect === "POSTGRESQL"\) replicaExecutor = await openPostgresExecutor\(replicaConfig\)/);
  assert.match(source,/else replicaExecutor = await openMssqlExecutor\(replicaConfig\)/);
});

test("MySQL replica health probes enforce TLS before creating any credentialed connection", () => {
  const start = source.indexOf("export async function checkMysqlReadReplica(");
  const end = source.indexOf("function sqlDialect(", start);
  assert.ok(start >= 0 && end > start);
  const health = source.slice(start, end);
  const policyCall = health.indexOf('assertSecureSourceSqlTransport(replicaSslEnabled, replicaTrustServerCertificate, "MySQL read-replica health")');
  const connection = health.indexOf("await createConnection(");
  assert.ok(policyCall >= 0 && connection > policyCall, "TLS must be checked before opening the replica health socket");
  assert.match(health, /const replicaSslEnabled = effective\.sqlReplicaSsl \?\? true/);
  assert.match(health, /const replicaTrustServerCertificate = effective\.sqlReplicaTrustServerCertificate \?\? false/);
  assert.match(health, /ssl: replicaSslEnabled \? \{ rejectUnauthorized: !replicaTrustServerCertificate \} : undefined/);
});

test("source factories consume the resolved credentials and TLS settings, not primary env overrides", () => {
  const start = source.indexOf("async function openPostgresExecutor(");
  const end = source.indexOf("function effectiveReplicaEnabled(", start);
  assert.ok(start >= 0 && end > start);
  const factories = source.slice(start, end);
  assert.doesNotMatch(factories, /process\.env\.SOURCE_SQL_PASSWORD/);
  assert.doesNotMatch(factories, /boolEnv\("SOURCE_SQL_SSL"\)/);
  assert.doesNotMatch(factories, /boolEnv\("SOURCE_SQL_TRUST_SERVER_CERTIFICATE"\)/);
  assert.equal(factories.split("password: config.sqlPassword").length - 1, 3,
    "all three SQL drivers must use the selected effective password");
  assert.equal(factories.split("config.sqlSsl ?? true").length - 1, 3);
  assert.equal(factories.split("config.sqlTrustServerCertificate ?? false").length - 1, 3);
  assert.match(source, /const token = config\.authToken \|\| null/);
});

test("replica selection never substitutes primary credentials or overrides saved enablement", () => {
  const start = source.indexOf("function effectiveReplicaEnabled(");
  const end = source.indexOf("function sqlDialect(", start);
  assert.ok(start >= 0 && end > start);
  const health = source.slice(start, end);
  assert.match(health, /return config\.sqlReplicaEnabled === true/);
  assert.match(health, /password: effective\.sqlReplicaPassword/);
  assert.doesNotMatch(health, /process\.env\.SOURCE_SQL_REPLICA_PASSWORD/);
  const adapter = source.slice(source.indexOf("async function createSqlAdapter("));
  assert.match(adapter, /sqlPassword: config\.sqlReplicaPassword/);
  assert.match(adapter, /if \(!replicaConfig\.sqlHost \|\| !replicaConfig\.sqlUsername \|\| !replicaConfig\.sqlPassword\)/);
});

test("Prisma analytics replica settings are normalized before credentialed connections", () => {
  const schema = readFileSync(new URL("../../prisma/schema.prisma", import.meta.url), "utf8");
  const fields = ["Enabled", "Host", "Port", "Database", "Schema", "Username",
    "Password", "Ssl", "TrustServerCertificate", "MaxLagSeconds"];
  for (const suffix of fields) {
    const column = "sourceAnalyticsReplica" + suffix;
    const adapterField = "sqlReplica" + suffix;
    assert.match(schema, new RegExp("\\b" + column + "\\s+"));
    assert.ok(source.includes("config." + adapterField + " ?? config." + column),
      column + " must be available through the normalized adapter field");
  }
});
