/**
 * Read-only, deliberately narrow parity gate for old PostgreSQL dashboard vs
 * direct MySQL historical reporting. Other metric definitions are NOT yet
 * equivalent (cohort, lifecycle and event dates differ) and must not be marked
 * as passing automatically.
 */
export interface ComparableDashboard {
  headcount?: number | null;
  filterContext?: { site?: string | null; income?: string | null; asAt?: string | null };
  dataQuality?: { headcountSource?: string | null };
}
export interface ComparableAsOf {
  asOfDate: string;
  workforce: { eligibleCount: string | null; observedAt: string | null };
}
export interface ParityResult {
  status: "PASS" | "FAIL" | "NOT_COMPARABLE";
  checkedMetric: "historical_headcount";
  postgres: number | null;
  mysql: number | null;
  difference: number | null;
  reason: string;
  otherMetrics: "NOT_ASSESSED";
}

function safeNonnegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

export function compareHistoricalHeadcount(
  pg: ComparableDashboard,
  mysql: ComparableAsOf,
): ParityResult {
  const base = {
    checkedMetric: "historical_headcount" as const,
    postgres: safeNonnegativeInteger(pg.headcount),
    mysql: safeNonnegativeInteger(mysql.workforce.eligibleCount),
    difference: null as number | null,
    otherMetrics: "NOT_ASSESSED" as const,
  };
  const no = (reason: string): ParityResult =>
    { ...base, status: "NOT_COMPARABLE", reason };
  const ctx = pg.filterContext;
  if (!ctx?.asAt || !/^\d{4}-\d{2}-\d{2}T/.test(ctx.asAt))
    return no("PostgreSQL dashboard has no valid as-of timestamp");
  if (ctx.asAt.slice(0, 10) !== mysql.asOfDate)
    return no("As-of dates differ");
  if (ctx.site && ctx.site !== "all" || ctx.income && ctx.income !== "all")
    return no("Site/income cohort filters are not covered by the source summary");
  if (!pg.dataQuality?.headcountSource?.startsWith("snapshot "))
    return no("PostgreSQL headcount comes from an employee/cache fallback, not a workforce snapshot");
  if (mysql.workforce.observedAt !== pg.dataQuality.headcountSource.slice("snapshot ".length))
    return no("The source and PostgreSQL selected different headcount observation dates");
  if (base.postgres === null || base.mysql === null)
    return no("Historical headcount is unavailable or outside the safe integer range");
  const difference = base.mysql - base.postgres;
  return {
    ...base, status: difference === 0 ? "PASS" : "FAIL",
    difference,
    reason: difference === 0
      ? "Headcount and observation date agree for the unfiltered employer"
      : "Historical workforce snapshot headcount differs",
  };
}
