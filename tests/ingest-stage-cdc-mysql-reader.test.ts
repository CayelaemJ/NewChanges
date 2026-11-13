import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { LOAD_ORDER, getFormat } from "../src/services/reportFormats.js";
import {
  buildCdcMysqlViewQuery,
  readCdcMysqlView,
  type CdcMysqlQueryConnection,
  type CdcMysqlReaderSettings,
} from "../src/services/ingestStageCdcMysqlReader.js";

const settings: CdcMysqlReaderSettings = {
  featureEnabled: true,
  accessReviewed: true,
  snapshotVerified: true,
  hostname: "fixture.abcdef.eu-north-1.rds.amazonaws.com",
  port: 3306,
  username: "cdc_readonly",
  password: "SYNTHETIC_TEST_ONLY",
  caCertificatePath: "/never-read-in-mocked-tests.pem",
  queryTimeoutMs: 10000,
  maxRows: 2,
};
const scope = { authorizedEmployerRefs: ["VIG"] } as const;

function mockMysql(feed: string, rows: Record<string, unknown>[]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  let ended = false;
  const names = getFormat(feed)!.fields.map(f => f.name);
  const db: CdcMysqlQueryConnection = {
    async query(command, params = []) {
      const sql = typeof command === "string" ? command : command.sql;
      calls.push({ sql, params });
      if (sql.includes("information_schema.COLUMNS"))
        return [names.map(COLUMN_NAME => ({ COLUMN_NAME })), []];
      if (sql.startsWith("SELECT ") && sql.includes(" FROM ")) return [rows, []];
      return [[], []];
    },
    async end() { ended = true; },
  };
  return { db, calls, isEnded: () => ended };
}

test("all ten canonical feeds allow only scoped read-only MySQL SELECT and no Postgres sync", async () => {
  assert.equal(LOAD_ORDER.length, 10);
  for (const feed of LOAD_ORDER) {
    const m = mockMysql(feed, [{
      employer_ref: "VIG", source_updated_at: null,
      unexpected_sensitive_internal_value: "DO_NOT_RETURN",
    }]);
    const result = await readCdcMysqlView(
      feed, "VIG", scope, settings, async () => m.db,
    );
    assert.equal(result.complete, true);
    assert.equal(result.source, "MYSQL_READ_ONLY");
    assert.equal(result.feed, feed);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0].employer_ref, "VIG");
    assert.equal(result.records[0].source_updated_at, null);
    assert.equal(Object.hasOwn(result.records[0], "unexpected_sensitive_internal_value"), false);
    const sqlCall = m.calls.find(call => call.sql.startsWith("SELECT ") && call.sql.includes(" FROM "));
    assert(sqlCall, feed);
    assert(sqlCall.sql.includes(" FROM " + String.fromCharCode(96) + "ingest_stage"));
    assert(sqlCall.sql.includes(" WHERE " + String.fromCharCode(96) + "employer_ref" + String.fromCharCode(96) + " = ?"));
    assert(!sqlCall.sql.includes("source_updated_at >"));
    assert(!sqlCall.sql.includes("SELECT *"));
    assert.deepEqual(sqlCall.params, ["VIG", 3]);
    assert.equal(m.calls[0].sql, "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    assert.equal(m.calls[1].sql, "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    assert.equal(m.calls.at(-1)?.sql, "ROLLBACK");
    assert.equal(m.isEnded(), true);
  }
});

test("source access gates deny connections without approvals and snapshot", async () => {
  for (const changed of [
    { featureEnabled: false },
    { accessReviewed: false },
    { snapshotVerified: false },
  ]) {
    let connects = 0;
    await assert.rejects(
      readCdcMysqlView("employees", "VIG", scope, { ...settings, ...changed },
        async () => { connects++; throw Error("SHOULD_NOT_OPEN"); }),
      /CDC_MYSQL_READ_GATE_CLOSED/,
    );
    assert.equal(connects, 0);
  }
});

test("server-issued tenant scope enforced before any connection", async () => {
  let connects = 0;
  for (const [feed, employer, tenants] of [
    ["employees", "UNAUTHORIZED", ["VIG"]],
    ["mysql.user", "VIG", ["VIG"]],
    ["employees", "VIG", []],
    ["employees", "VIG", ["OTHER"]],
    ["employees", "VIG", ["VIG", " "]],
  ] as const) {
    await assert.rejects(
      readCdcMysqlView(feed, employer, { authorizedEmployerRefs: [...tenants] }, settings,
        async () => { connects++; throw Error("SHOULD_NOT_OPEN"); }),
    );
  }
  assert.equal(connects, 0);
});

test("reject RDS master/admin, non-RDS endpoint and bad TLS settings", async () => {
  for (const changed of [
    { username: "fixeradmin" },
    { username: "root" },
    { username: "regular_user" },
    { hostname: "127.0.0.1" },
    { hostname: "rds.amazonaws.com.evil.invalid" },
    { caCertificatePath: "" },
    { password: "" },
    { queryTimeoutMs: 90000 },
    { maxRows: 2001 },
  ]) {
    let opened = 0;
    await assert.rejects(readCdcMysqlView("employees", "VIG", scope,
      { ...settings, ...changed }, async () => { opened++; throw Error("OPENED"); }));
    assert.equal(opened, 0);
  }
});

test("required view columns are verified before any reporting data is selected", async () => {
  assert.throws(() => buildCdcMysqlViewQuery("employees", "VIG", new Set([
    "employer_ref", "source_updated_at",
  ]), 5), /CDC_MYSQL_VIEW_CONTRACT_INCOMPLETE/);
  assert.throws(() => buildCdcMysqlViewQuery("employees;DROP TABLE users", "VIG",
    new Set(), 5), /NOT_ALLOWLISTED/);
  const fmt = getFormat("employees")!;
  const query = buildCdcMysqlViewQuery("employees", "VIG",
    new Set(fmt.fields.map(field => field.name)), 5);
  assert.equal(query.params[0], "VIG");
  assert.equal(query.params[1], 6);
  assert(!query.sql.includes(";"));
  assert(!query.sql.includes(" JOIN "));
  assert(!query.sql.includes("source_updated_at >"));
});

test("more rows than the hard limit fail closed; no partial dashboard published", async () => {
  const m = mockMysql("employers", [
    { employer_ref: "VIG" },
    { employer_ref: "VIG" },
    { employer_ref: "VIG" },
  ]);
  await assert.rejects(
    readCdcMysqlView("employers", "VIG", scope, settings, async () => m.db),
    /CDC_MYSQL_VIEW_READ_FAILED/,
  );
  assert.equal(m.calls.at(-1)?.sql, "ROLLBACK");
  assert.equal(m.isEnded(), true);
});

test("driver-side cross-employer rows fail closed even after SQL WHERE filter", async () => {
  const m = mockMysql("employers", [{ employer_ref: "OTHER" }]);
  await assert.rejects(
    readCdcMysqlView("employers", "VIG", scope, settings, async () => m.db),
    /CDC_MYSQL_VIEW_READ_FAILED/,
  );
  assert.equal(m.isEnded(), true);
});

test("MySQL driver configuration mandates TLS hostname checks and query timeouts", () => {
  const source = readFileSync(new URL("../src/services/ingestStageCdcMysqlReader.ts", import.meta.url), "utf8");
  assert.match(source, /verifyIdentity:\s*true/);
  assert.match(source, /rejectUnauthorized:\s*true/);
  assert.match(source, /multipleStatements:\s*false/);
  assert.match(source, /START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY/);
  assert.match(source, /timeout:\s*settings\.queryTimeoutMs/);
  assert(!source.includes("ssl: false"));
  assert(!source.includes("import { runSync }"));
});

test("connection failures are redacted before propagating to callers", async () => {
  await assert.rejects(
    readCdcMysqlView("employees", "VIG", scope, settings,
      async () => { throw new Error("AWS_ENDPOINT_PRIVATE_SECRET"); }),
    error => error instanceof Error &&
      error.message === "CDC_MYSQL_VIEW_READ_FAILED" &&
      !error.message.includes("AWS_ENDPOINT_PRIVATE_SECRET"),
  );
});

test("query failures roll back and close without leaking sensitive driver messages", async () => {
  const calls: string[] = [];
  const db: CdcMysqlQueryConnection = {
    async query(command) {
      const sql = typeof command === "string" ? command : command.sql;
      calls.push(sql);
      if (sql.includes("information_schema.COLUMNS"))
        throw new Error("mysql credentials and raw rows NEVER_PRINT");
      return [[], []];
    },
    async end() { calls.push("END"); },
  };
  await assert.rejects(
    readCdcMysqlView("employees", "VIG", scope, settings, async () => db),
    error => error instanceof Error &&
      error.message === "CDC_MYSQL_VIEW_READ_FAILED" &&
      !error.message.includes("NEVER_PRINT"),
  );
  assert(calls.includes("ROLLBACK"));
  assert.equal(calls.at(-1), "END");
});
