import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("direct MySQL reporting mode prevents PostgreSQL business-row copying", () => {
  const sync = readFileSync("src/services/syncService.ts", "utf8");
  const refresh = readFileSync("src/services/dailyRefresh.ts", "utf8");
  it("fails closed at the entry of every source sync before leases or writes", () => {
    const start = sync.indexOf('export async function runSync(');
    expect(start).toBeGreaterThan(-1);
    const head = sync.slice(start, start + 1100);
    expect(head).toContain('DIRECT_MYSQL_NO_REPLICATION === "true"');
    expect(head).toContain('status: "DIRECT_REPORTING_ONLY"');
    expect(head.indexOf("DIRECT_MYSQL_NO_REPLICATION")).toBeLessThan(head.indexOf("openIncrementalSyncLease()"));
  });
  it("blocks manual and reset full refresh before purging application projections", () => {
    const start = refresh.indexOf("async function runAuthoritativeFullRefresh(");
    expect(start).toBeGreaterThan(-1);
    const head = refresh.slice(start, start + 1100);
    expect(head).toContain('DIRECT_MYSQL_NO_REPLICATION === "true"');
    expect(head).toContain('status: "DIRECT_REPORTING_ONLY"');
    const body = refresh.slice(start);
    expect(body.indexOf("DIRECT_MYSQL_NO_REPLICATION")).toBeLessThan(body.indexOf("purgeDashboardDataForFullRefresh("));
  });
});
