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
