import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const fake = vi.hoisted(() => {
  const query = vi.fn();
  const end = vi.fn(async () => undefined);
  const createConnection = vi.fn(async () => ({ query, end }));
  return { query, end, createConnection };
});
vi.mock("mysql2/promise", () => ({ createConnection: fake.createConnection }));
import { inspectMysqlReportingReadiness } from "../src/services/directMysqlReportingPreflight.js";

const config = {
  sourceMode: "SQL",
  sqlDialect: "MYSQL",
  sqlHost: "example.aws.invalid",
  sqlDatabase: "ingest_stage",
  sqlUsername: "report_reader",
  sqlPassword: "test-only-placeholder",
  sqlSsl: true,
  sqlTrustServerCertificate: false,
  sqlViewPrefix: "v_",
};

const schema: Record<string, string[]> = {
  v_employers: ["employer_ref", "name", "source_updated_at"],
  v_employees: ["employer_ref", "payroll_ref", "observed_at", "eligible_from", "source_updated_at"],
  v_platform_users: ["employer_ref", "payroll_ref", "enrolled_at", "source_updated_at"],
  v_journeys: ["employer_ref", "started_at", "status", "monthly_saving_rand", "source_updated_at"],
  v_ratings: ["employer_ref", "created_at", "stars", "source_updated_at"],
  v_referrals: ["employer_ref", "shared_at", "converted", "source_updated_at"],
  v_salary_advances: ["employer_ref", "advanced_at", "salary_advance_status", "amount", "source_updated_at"],
  v_workforce_snapshots: ["employer_ref", "as_of_date", "eligible_count", "source_updated_at"],
  v_debt_accounts: ["employer_ref", "account_ref", "observed_at", "source_updated_at",
    "balance_rand", "in_arrears", "closed_at", "is_deleted"],
  v_policies: ["employer_ref", "policy_ref", "observed_at", "source_updated_at",
    "premium_rand", "is_wasteful", "is_resolved", "effective_from", "effective_to", "is_deleted"],
};
const tables = Object.keys(schema).map(TABLE_NAME => ({ TABLE_NAME, TABLE_TYPE: "VIEW" }));
const columns = Object.entries(schema).flatMap(([TABLE_NAME, fields]) =>
  fields.map(COLUMN_NAME => ({ TABLE_NAME, COLUMN_NAME })));

describe("MySQL direct reporting preflight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECT_MYSQL_REPORTING_ENABLED = "true";
    delete process.env.SOURCE_CONFIG_LOCKED;
    for (const key of [
      "SOURCE_MODE", "SOURCE_SQL_DIALECT", "SOURCE_SQL_HOST", "SOURCE_SQL_DATABASE",
      "SOURCE_SQL_USERNAME", "SOURCE_SQL_PASSWORD", "SOURCE_SQL_SSL", "SOURCE_SQL_VIEW_PREFIX",
    ]) delete process.env[key];
    fake.query.mockImplementation(async (input: any) => {
      if (input.sql.includes("information_schema.TABLES")) return [tables, []];
      if (input.sql.includes("information_schema.COLUMNS")) return [columns, []];
      throw new Error("Unexpected query");
    });
  });

  it("checks required reporting views and columns using only information_schema", async () => {
    const result = await inspectMysqlReportingReadiness(config);
    expect(result.ready).toBe(true);
    expect(result.productionCutoverReady).toBe(false);
    expect(result.checks).toHaveLength(10);
    expect(result.checks.every(check => check.compatible)).toBe(true);
    expect(fake.query).toHaveBeenCalledTimes(2);
    for (const [command, params] of fake.query.mock.calls) {
      expect(command.sql).toContain("information_schema.");
      expect(command.sql).not.toMatch(/\bUPDATE\b|\bINSERT\b|\bDELETE\b/i);
      expect(params[0]).toBe("ingest_stage");
    }
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it("fails readiness on missing historical columns or views", async () => {
    fake.query.mockImplementation(async (input: any) => {
      if (input.sql.includes("information_schema.TABLES"))
        return [tables.filter(table => table.TABLE_NAME !== "v_workforce_snapshots"), []];
      if (input.sql.includes("information_schema.COLUMNS"))
        return [columns.filter(c => c.COLUMN_NAME !== "is_deleted" &&
          c.TABLE_NAME !== "v_workforce_snapshots"), []];
      return [[], []];
    });
    const result = await inspectMysqlReportingReadiness(config);
    expect(result.ready).toBe(false);
    expect(result.productionCutoverReady).toBe(false);
    expect(result.checks.find(c => c.view === "v_workforce_snapshots")?.present).toBe(false);
    expect(result.checks.find(c => c.view === "v_debt_accounts")?.missingColumns).toContain("is_deleted");
  });

  it("rejects non-MySQL or insecure sources before connecting", async () => {
    await expect(inspectMysqlReportingReadiness({ ...config, sqlSsl: false }))
      .rejects.toThrow(/Verified-TLS/);
    await expect(inspectMysqlReportingReadiness({ ...config, sqlDialect: "MSSQL" }))
      .rejects.toThrow(/Verified-TLS/);
    expect(fake.createConnection).not.toHaveBeenCalled();
  });

  it("requires admin authentication on the metadata endpoint", () => {
    const src = readFileSync("src/server.ts", "utf8");
    const at = src.indexOf('app.get("/api/admin/integration/direct-reporting/preflight"');
    expect(at).toBeGreaterThan(-1);
    const route = src.slice(at, at + 950);
    expect(route.indexOf("requireAdmin(req, reply)")).toBeLessThan(route.indexOf("getSyncConfig()"));
    expect(route.indexOf("requireAdmin(req, reply)")).toBeLessThan(route.indexOf("inspectMysqlReportingReadiness"));
  });
});
