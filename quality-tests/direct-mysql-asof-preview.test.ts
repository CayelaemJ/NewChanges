import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const db = vi.hoisted(() => {
  const query = vi.fn();
  const end = vi.fn(async () => undefined);
  const createConnection = vi.fn(async () => ({ query, end }));
  return { query, end, createConnection };
});
vi.mock("mysql2/promise", () => ({ createConnection: db.createConnection }));
import { readDirectAsOfPreview } from "../src/services/directMysqlAsOfPreview.js";

const source = {
  sourceMode: "SQL", sqlDialect: "MYSQL",
  sqlHost: "reporting.example.org", sqlDatabase: "reporting",
  sqlUsername: "report_reader", sqlPassword: "fictional-test-value",
  sqlSsl: true, sqlTrustServerCertificate: false, sqlViewPrefix: "v_",
};
const input = { employerRef: "EMPLOYER-1", asOfDate: "2026-10-31" };

describe("as-of MySQL reporting without copying source data", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DIRECT_MYSQL_REPORTING_ENABLED = "true";
    delete process.env.SOURCE_CONFIG_LOCKED;
    for (const key of [
      "SOURCE_MODE", "SOURCE_SQL_DIALECT", "SOURCE_SQL_HOST", "SOURCE_SQL_DATABASE",
      "SOURCE_SQL_USERNAME", "SOURCE_SQL_PASSWORD", "SOURCE_SQL_SSL", "SOURCE_SQL_VIEW_PREFIX",
    ]) delete process.env[key];
    db.query.mockImplementation(async (arg: any) => {
      if (typeof arg !== "object") return [[], []];
      if (arg.sql.includes("eligible_count AS eligibleCount"))
        return [[{ eligibleCount: 125, observedAt: "2026-10-30" }], []];
      if (arg.sql.includes("PARTITION BY account_ref"))
        return [[{ total: 18, balance: "18200.50", arrears: 4 }], []];
      return [[{ total: 11, premium: "2250.75", wasteful: 2 }], []];
    });
  });

  it("queries all historical views consistently and preserves employer predicates", async () => {
    const result = await readDirectAsOfPreview(source, input);
    expect(result).toMatchObject({
      source: "MYSQL", mode: "AS_OF_PREVIEW", replicatedToPostgres: false,
      workforce: { eligibleCount: "125", observedAt: "2026-10-30" },
      debts: { activeAccounts: "18", outstandingBalanceRand: "18200.50", inArrearsAccounts: "4" },
      policies: { activePolicies: "11", monthlyPremiumRand: "2250.75", wastefulPolicies: "2" },
    });
    const reads = db.query.mock.calls.filter(([arg]: any[]) => typeof arg === "object");
    expect(reads).toHaveLength(3);
    for (const [arg, params] of reads) {
      expect(arg.sql).toContain("employer_ref = ?");
      expect(params[0]).toBe("EMPLOYER-1");
      expect(params[1]).toBe("2026-10-31");
    }
    expect(reads[1][0].sql).toContain("ROW_NUMBER() OVER");
    expect(reads[1][0].sql).toContain("PARTITION BY account_ref");
    expect(reads[2][0].sql).toContain("PARTITION BY policy_ref");
    expect(db.query).toHaveBeenCalledWith("SET TRANSACTION READ ONLY");
    expect(db.query).toHaveBeenCalledWith("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    expect(db.query).toHaveBeenCalledWith("ROLLBACK");
    expect(db.end).toHaveBeenCalledOnce();
  });

  it("does not invent a historical workforce denominator when absent", async () => {
    db.query.mockImplementation(async (arg: any) => {
      if (typeof arg !== "object") return [[], []];
      if (arg.sql.includes("eligible_count AS eligibleCount")) return [[], []];
      return [[{ total: 0, balance: 0, arrears: 0, premium: 0, wasteful: 0 }], []];
    });
    const result = await readDirectAsOfPreview(source, input);
    expect(result.workforce).toEqual({ eligibleCount: null, observedAt: null });
  });

  it("rejects malformed dates before connecting to MySQL", async () => {
    await expect(readDirectAsOfPreview(source, { ...input, asOfDate: "2026-02-30" }))
      .rejects.toThrow(/Invalid as-of/);
    expect(db.createConnection).not.toHaveBeenCalled();
  });

  it("enforces tenant authorization before retrieving source credentials", () => {
    const server = readFileSync("src/server.ts", "utf8");
    const at = server.indexOf('"/api/employers/:employerId/direct-reporting-asof-preview"');
    expect(at).toBeGreaterThan(-1);
    const route = server.slice(at, at + 1250);
    expect(route.indexOf("canViewEmployer(user, req.params.employerId)"))
      .toBeLessThan(route.indexOf("getSyncConfig()"));
    expect(route.indexOf("hasVerifiedMfaSession(req, user.id)"))
      .toBeLessThan(route.indexOf("getSyncConfig()"));
  });
});
