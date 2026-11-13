import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const db = vi.hoisted(() => {
  const query = vi.fn();
  const end = vi.fn(async () => undefined);
  const createConnection = vi.fn(async () => ({ query, end }));
  return { query, end, createConnection };
});
vi.mock("mysql2/promise", () => ({ createConnection: db.createConnection }));
import { readDirectDashboardPreview } from "../src/services/directMysqlDashboardPreview.js";

const source = {
  sourceMode: "SQL",
  sqlDialect: "MYSQL",
  sqlHost: "reporting.example.org",
  sqlPort: 3306,
  sqlDatabase: "reporting",
  sqlUsername: "report_reader",
  sqlPassword: "fictional-test-value",
  sqlSsl: true,
  sqlTrustServerCertificate: false,
  sqlViewPrefix: "v_",
};
const input = { employerRef: "TENANT-ONE", startDate: "2026-10-01", endDate: "2026-11-01" };

describe("tenant-scoped direct MySQL dashboard preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECT_MYSQL_REPORTING_ENABLED = "true";
    delete process.env.SOURCE_CONFIG_LOCKED;
    for (const key of [
      "SOURCE_MODE", "SOURCE_SQL_DIALECT", "SOURCE_SQL_HOST", "SOURCE_SQL_DATABASE",
      "SOURCE_SQL_USERNAME", "SOURCE_SQL_PASSWORD", "SOURCE_SQL_SSL", "SOURCE_SQL_VIEW_PREFIX",
    ]) delete process.env[key];
    db.query.mockImplementation(async (arg: any) => {
      if (typeof arg === "object") {
        return [[{ total: "14", secondary: "4", amount: "250.25", completedInPeriod: "9", completedSavings: "380.75" }], []];
      }
      return [[], []];
    });
  });

  it("aggregates four canonical MySQL feeds from one read-only snapshot", async () => {
    const result = await readDirectDashboardPreview(source, input);
    expect(result).toMatchObject({
      source: "MYSQL", mode: "DIRECT_PREVIEW", replicatedToPostgres: false,
      employerRef: input.employerRef, journeys: { started: "14", completedOfStarted: "4", completedInPeriod: "9", completedInPeriodMonthlySavingsRand: "380.75" },
      ratings: { submitted: "14", fiveStar: "4" },
      referrals: { shared: "14", convertedAmongShared: "4" },
      salaryAdvances: { requested: "14", finalised: "4", finalisedAmountRand: "250.25" },
    });
    expect(db.createConnection).toHaveBeenCalledOnce();
    expect(db.query).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
    expect(db.query).toHaveBeenCalledWith("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
    expect(db.end).toHaveBeenCalledOnce();
    const reads = db.query.mock.calls.filter(([sql]: any[]) => typeof sql === "object");
    expect(reads).toHaveLength(4);
    for (const [index, [statement, params]] of reads.entries()) {
      expect(statement.sql).toContain("employer_ref = ?");
      if (index === 0) {
        expect(statement.sql).toContain("completed_at >= ?");
        expect(statement.sql).toContain("completed_at < ?");
        expect(params).toHaveLength(15);
        expect(params[10]).toBe("TENANT-ONE");
        expect(params[11]).toBe("2026-10-01");
        expect(params[12]).toBe("2026-11-01");
      } else {
        expect(params).toEqual(["TENANT-ONE", "2026-10-01", "2026-11-01"]);
      }
      expect(statement.timeout).toBe(10_000);
    }
  });

  it("fails closed for disabled reporting, wrong source or invalid date", async () => {
    delete process.env.DIRECT_MYSQL_REPORTING_ENABLED;
    await expect(readDirectDashboardPreview(source, input)).rejects.toThrow(/disabled/);
    process.env.DIRECT_MYSQL_REPORTING_ENABLED = "true";
    await expect(readDirectDashboardPreview({ ...source, sqlDialect: "POSTGRESQL" }, input))
      .rejects.toThrow(/MySQL/);
    await expect(readDirectDashboardPreview(source, { ...input, endDate: "2026-11-31" }))
      .rejects.toThrow(/Invalid date/);
    await expect(readDirectDashboardPreview(source, { ...input, endDate: "2028-01-01" }))
      .rejects.toThrow(/exceeds one year/);
    expect(db.createConnection).not.toHaveBeenCalled();
  });

  it("has an authorization gate before source credentials or MySQL are accessed", () => {
    const server = readFileSync("src/server.ts", "utf8");
    const start = server.indexOf('"/api/employers/:employerId/direct-reporting-preview"');
    expect(start).toBeGreaterThan(-1);
    const section = server.slice(start, start + 1400);
    expect(section.indexOf("requireUser(req, reply)")).toBeLessThan(section.indexOf("getSyncConfig()"));
    expect(section.indexOf("canViewEmployer(user, req.params.employerId)"))
      .toBeLessThan(section.indexOf("getSyncConfig()"));
    expect(section.indexOf("hasVerifiedMfaSession(req, user.id)"))
      .toBeLessThan(section.indexOf("getSyncConfig()"));
  });
});
