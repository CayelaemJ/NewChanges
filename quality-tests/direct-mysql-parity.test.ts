import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compareHistoricalHeadcount } from "../src/services/directMysqlParity.js";

const dashboard = {
  headcount: 125,
  filterContext: { asAt: "2026-10-31T23:59:59.999Z", site: null, income: null },
  dataQuality: { headcountSource: "snapshot 2026-10-30" },
};
const source = {
  asOfDate: "2026-10-31",
  workforce: { eligibleCount: "125", observedAt: "2026-10-30" },
};

describe("direct MySQL vs PostgreSQL historical headcount parity", () => {
  it("passes only exact snapshot-backed counts and observation dates", () => {
    expect(compareHistoricalHeadcount(dashboard, source)).toMatchObject({
      status: "PASS", difference: 0, postgres: 125, mysql: 125,
      otherMetrics: "NOT_ASSESSED",
    });
  });
  it("reports a real mismatch, never silently substitutes or rounds", () => {
    expect(compareHistoricalHeadcount(dashboard, {
      ...source, workforce: { ...source.workforce, eligibleCount: "127" },
    })).toMatchObject({ status: "FAIL", difference: 2 });
  });
  it("refuses to compare mismatched dates", () => {
    expect(compareHistoricalHeadcount(dashboard, {
      ...source, asOfDate: "2026-10-30",
    }).status).toBe("NOT_COMPARABLE");
  });
  it("refuses comparing snapshot counts to fallback or site-cohort counts", () => {
    expect(compareHistoricalHeadcount({
      ...dashboard, dataQuality: { headcountSource: "effective employee rows" },
    }, source).status).toBe("NOT_COMPARABLE");
    expect(compareHistoricalHeadcount({
      ...dashboard, filterContext: { ...dashboard.filterContext, site: "A" },
    }, source).status).toBe("NOT_COMPARABLE");
  });
  it("requires exact source observation date", () => {
    expect(compareHistoricalHeadcount(dashboard, {
      ...source, workforce: { ...source.workforce, observedAt: "2026-10-29" },
    }).status).toBe("NOT_COMPARABLE");
  });
  it("does not coerce missing values to zero or allow unsafe counts", () => {
    expect(compareHistoricalHeadcount({ ...dashboard, headcount: null }, source).status).toBe("NOT_COMPARABLE");
    expect(compareHistoricalHeadcount(dashboard, {
      ...source, workforce: { ...source.workforce, eligibleCount: "9007199254740992" },
    }).status).toBe("NOT_COMPARABLE");
  });
  it("accepts valid YYYY-MM periods and validates ISO as-of dates with numeric regexes", () => {
    const code = readFileSync("src/server.ts", "utf8");
    const start = code.indexOf('"/api/admin/integration/direct-reporting/parity/:employerId"');
    const section = code.slice(start, start + 1300);
    expect(section).toContain(String.raw`/^\d{4}-(0[1-9]|1[0-2])$/`);
    expect(section).toContain(String.raw`/^\d{4}-\d{2}-\d{2}$/`);
    expect(section).not.toContain(String.raw`/^\\d{4}`);
  });
  it("protects the parity route with admin MFA and tenant authorization before source access", () => {
    const code = readFileSync("src/server.ts", "utf8");
    const at = code.indexOf('"/api/admin/integration/direct-reporting/parity/:employerId"');
    expect(at).toBeGreaterThan(-1);
    const route = code.slice(at, at + 1700);
    expect(route.indexOf("requireAdmin(req, reply)")).toBeLessThan(route.indexOf("getSyncConfig()"));
    expect(route.indexOf("canViewEmployer(admin, req.params.employerId)"))
      .toBeLessThan(route.indexOf("getSyncConfig()"));
    expect(route).toContain("compareHistoricalHeadcount(dashboard, source)");
  });
});
