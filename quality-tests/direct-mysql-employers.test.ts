import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const db = vi.hoisted(() => {
  const query = vi.fn();
  const end = vi.fn(async () => undefined);
  const createConnection = vi.fn(async () => ({ query, end }));
  return { query, end, createConnection };
});
vi.mock("mysql2/promise", () => ({ createConnection: db.createConnection }));
import { discoverDirectMysqlEmployers } from "../src/services/directMysqlEmployers.js";

const config = {
  sourceMode: "SQL", sqlDialect: "MYSQL", sqlHost: "reporting.example.org",
  sqlDatabase: "ingest_stage", sqlUsername: "report_reader",
  sqlPassword: "fake-ci-fixture", sqlSsl: true,
  sqlTrustServerCertificate: false, sqlViewPrefix: "v_",
};

describe("source employer discovery without PostgreSQL replication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECT_MYSQL_REPORTING_ENABLED = "true";
    delete process.env.SOURCE_CONFIG_LOCKED;
    for (const key of ["SOURCE_MODE", "SOURCE_SQL_DIALECT", "SOURCE_SQL_HOST",
      "SOURCE_SQL_DATABASE", "SOURCE_SQL_USERNAME", "SOURCE_SQL_PASSWORD",
      "SOURCE_SQL_SSL", "SOURCE_SQL_VIEW_PREFIX"]) delete process.env[key];
    db.query.mockImplementation(async (arg: any) =>
      typeof arg === "object"
        ? [[{ employer_ref: "EMP-001", name: "Test Employer" }], []]
        : [[], []]);
  });
  it("returns only minimal employer identity fields, never writes PG data", async () => {
    const data = await discoverDirectMysqlEmployers(config);
    expect(data).toEqual({
      source: "MYSQL", employers: [{ employerRef: "EMP-001", name: "Test Employer" }],
      nextAfter: null, copiedToPostgres: false,
    });
    const selects = db.query.mock.calls.filter(([x]: any[]) => typeof x === "object");
    expect(selects).toHaveLength(1);
    expect(selects[0][0].sql).toContain("LIMIT 101");
    expect(selects[0][0].sql).toContain("FROM `ingest_stage`.`v_employers`");
    expect(db.query).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
    expect(db.end).toHaveBeenCalledOnce();
  });
  it("uses a parameterized keyset cursor and bounded page", async () => {
    const list = Array.from({ length: 101 }, (_, i) => ({
      employer_ref: "EMP-" + String(i + 1).padStart(3, "0"), name: "Employer " + i,
    }));
    db.query.mockImplementation(async (arg: any) => typeof arg === "object" ? [list, []] : [[], []]);
    const data = await discoverDirectMysqlEmployers(config, "EMP-000");
    expect(data.employers).toHaveLength(100);
    expect(data.nextAfter).toBe("EMP-100");
    const args = db.query.mock.calls.find(([x]: any[]) => typeof x === "object");
    expect(args?.[1]).toEqual(["EMP-000", "EMP-000"]);
  });
  it("refuses invalid source and cursor before connecting", async () => {
    await expect(discoverDirectMysqlEmployers({ ...config, sqlSsl: false }))
      .rejects.toThrow(/Verified-TLS/);
    await expect(discoverDirectMysqlEmployers(config, ""))
      .rejects.toThrow(/Invalid employer cursor/);
    expect(db.createConnection).not.toHaveBeenCalled();
  });
  it("protects discovery with admin authentication before accessing credentials", () => {
    const server = readFileSync("src/server.ts", "utf8");
    const at = server.indexOf('app.get<{ Querystring: { after?: string } }>("/api/admin/integration/direct-reporting/employers"');
    expect(at).toBeGreaterThan(-1);
    const segment = server.slice(at, at + 750);
    expect(segment.indexOf("requireAdmin(req, reply)")).toBeLessThan(segment.indexOf("getSyncConfig()"));
  });
});
