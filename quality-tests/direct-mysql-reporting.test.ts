import { beforeEach, describe, expect, it, vi } from "vitest";

const connection = vi.hoisted(() => {
  const query = vi.fn();
  const end = vi.fn(async () => undefined);
  const createConnection = vi.fn(async () => ({ query, end }));
  return { query, end, createConnection };
});
vi.mock("mysql2/promise", () => ({ createConnection: connection.createConnection }));

import { readMysqlReportSummary, readMysqlJourneyKpis, readMysqlEventMetrics } from "../src/services/directMysqlReporting.js";

const config = {
  sourceMode: "SQL",
  sqlDialect: "MYSQL",
  sqlHost: "reporting.example.org",
  sqlPort: 3306,
  sqlDatabase: "reporting",
  sqlUsername: "report_reader",
  sqlPassword: "test-only-never-real",
  sqlSsl: true,
  sqlTrustServerCertificate: false,
  sqlViewPrefix: "v_",
};

describe("direct MySQL reporting: no replication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECT_MYSQL_REPORTING_ENABLED = "true";
    delete process.env.SOURCE_CONFIG_LOCKED;
    for (const key of [
      "SOURCE_MODE", "SOURCE_SQL_DIALECT", "SOURCE_SQL_HOST",
      "SOURCE_SQL_DATABASE", "SOURCE_SQL_USERNAME", "SOURCE_SQL_PASSWORD",
      "SOURCE_SQL_VIEW_PREFIX", "SOURCE_SQL_SSL",
    ]) delete process.env[key];
    connection.query.mockImplementation(async (query: any) => {
      if (typeof query === "object" && query.sql?.includes("COUNT(*)")) {
        return [[{ recordCount: "123", latestSourceUpdate: "2026-11-13 08:00:00" }], []];
      }
      return [[], []];
    });
  });
  it("rejects all direct queries when the opt-in gate is disabled", async () => {
    delete process.env.DIRECT_MYSQL_REPORTING_ENABLED;
    await expect(readMysqlReportSummary(config, { reportKey: "employees" })).rejects.toThrow(/disabled/);
    expect(connection.createConnection).not.toHaveBeenCalled();
  });
  it("rejects unapproved feed names before opening a connection", async () => {
    await expect(readMysqlReportSummary(config, { reportKey: "employees; DROP TABLE users" })).rejects.toThrow(/Unknown reporting feed/);
    expect(connection.createConnection).not.toHaveBeenCalled();
  });
  it("requires TLS certificate verification", async () => {
    await expect(readMysqlReportSummary({ ...config, sqlSsl: false }, { reportKey: "employees" })).rejects.toThrow(/verified TLS/);
    expect(connection.createConnection).not.toHaveBeenCalled();
  });
  it("executes fixed aggregate SQL with a bound employer reference and closes connection", async () => {
    const result = await readMysqlReportSummary(config, { reportKey: "employees", employerRef: "EMP-' OR 1=1 --" });
    expect(result).toMatchObject({
      source: "MYSQL", reportKey: "employees", view: "v_employees",
      recordCount: "123", replicatedToPostgres: false,
    });
    expect(connection.createConnection).toHaveBeenCalledWith(expect.objectContaining({
      ssl: { rejectUnauthorized: true }, multipleStatements: false,
    }));
    const statement = connection.query.mock.calls.find(([arg]: any[]) => typeof arg === "object")!;
    expect(statement[0].sql).toContain("FROM `reporting`.`v_employees` WHERE employer_ref = ?");
    expect(statement[1]).toEqual(["EMP-' OR 1=1 --"]);
    expect(connection.query).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
    expect(connection.query).toHaveBeenCalledWith("ROLLBACK");
    expect(connection.end).toHaveBeenCalledTimes(1);
  });
  it("rejects database names with SQL metacharacters", async () => {
    await expect(readMysqlReportSummary({ ...config, sqlDatabase: "bad;drop" }, { reportKey: "employees" }))
      .rejects.toThrow(/Invalid database/);
    expect(connection.createConnection).not.toHaveBeenCalled();
  });
  it("queries source-side journey activity without committing source rows", async () => {
    connection.query.mockImplementation(async (arg: any) => {
      if (typeof arg === "object" && arg.sql?.includes("startedJourneys")) {
        return [[{ startedJourneys: "19", completedOfStartedJourneys: "6", savingsRand: "820.25" }], []];
      }
      return [[], []];
    });
    const result = await readMysqlJourneyKpis(config, {
      employerRef: "EMP-123", startDate: "2026-01-01", endDate: "2026-02-01",
    });
    expect(result).toMatchObject({
      source: "MYSQL", startedJourneys: "19",
      completedOfStartedJourneys: "6",
      monthlySavingsOfCompletedStartedJourneysRand: "820.25",
      replicatedToPostgres: false,
    });
    const stmt = connection.query.mock.calls.find(([arg]: any[]) =>
      typeof arg === "object" && arg.sql?.includes("startedJourneys"));
    expect(stmt?.[0].sql).toContain("FROM `reporting`.`v_journeys`");
    expect(stmt?.[1]).toEqual(["EMP-123", "2026-01-01", "2026-02-01"]);
    expect(connection.query).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
    expect(connection.end).toHaveBeenCalledOnce();
  });
  it("rejects invalid or oversized journey date windows before MySQL connection", async () => {
    await expect(readMysqlJourneyKpis(config, {
      employerRef: "EMP-123", startDate: "2026-02-30", endDate: "2026-03-01",
    })).rejects.toThrow(/Invalid report date/);
    await expect(readMysqlJourneyKpis(config, {
      employerRef: "EMP-123", startDate: "2024-01-01", endDate: "2026-01-01",
    })).rejects.toThrow(/exceeds one year/);
    expect(connection.createConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["ratings", "v_ratings", "created_at", "rated_five_stars"],
    ["referrals", "v_referrals", "shared_at", "converted_referrals"],
    ["salary_advances", "v_salary_advances", "advanced_at", "finalised_advances"],
  ] as const)("reads %s metrics directly from MySQL", async (feed, view, dateColumn, meaning) => {
    connection.query.mockImplementation(async (arg: any) => {
      if (typeof arg === "object" && arg.sql?.includes("eventCount"))
        return [[{ eventCount: "12", secondaryCount: "7", amountRand: feed === "salary_advances" ? "3300.50" : null }], []];
      return [[], []];
    });
    const result = await readMysqlEventMetrics(config, {
      feed, employerRef: "EMP-123", startDate: "2026-10-01", endDate: "2026-11-01",
    });
    expect(result).toMatchObject({
      source: "MYSQL", feed, eventCount: "12", secondaryCount: "7",
      secondaryMeaning: meaning, replicatedToPostgres: false,
    });
    const queryCall = connection.query.mock.calls.find(([arg]: any[]) =>
      typeof arg === "object" && arg.sql?.includes("eventCount"));
    expect(queryCall?.[0].sql).toContain(view);
    expect(queryCall?.[0].sql).toContain(dateColumn);
    expect(queryCall?.[1]).toEqual(["EMP-123", "2026-10-01", "2026-11-01"]);
    expect(connection.end).toHaveBeenCalledOnce();
  });

  it("refuses unapproved event feeds before connecting", async () => {
    await expect(readMysqlEventMetrics(config, {
      feed: "employees" as any, employerRef: "EMP-123",
      startDate: "2026-10-01", endDate: "2026-11-01",
    })).rejects.toThrow(/Unknown event feed/);
    expect(connection.createConnection).not.toHaveBeenCalled();
  });

});
