export type AnalyticsExecutionMode = "POSTGRES" | "SOURCE" | "HYBRID";
export type AnalyticsWorkloadClass = "SOURCE_ONLY" | "SOURCE_AGGREGATE" | "POSTGRES_READ_MODEL" | "HYBRID";

export interface AnalyticsPeriod {
  mode: "month" | "quarter" | "30d" | "year";
  currentKey: string | null;
  comparisonKey: string | null;
  currentLabel: string;
  comparisonLabel: string;
}

export interface AnalyticsMetricValue {
  value: number;
  available: boolean;
  source: AnalyticsExecutionMode;
  workloadClass: AnalyticsWorkloadClass;
}

export function previousMonthKey(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function previousQuarterKey(quarter: string): string {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) throw new Error("quarter must be YYYY-Q1..YYYY-Q4");
  const q = Number(match[2]);
  const year = Number(match[1]) - (q === 1 ? 1 : 0);
  return `${year}-Q${q === 1 ? 4 : q - 1}`;
}

export function comparisonForSelection(selection: {
  period?: string | null;
  quarter?: string | null;
  range?: "30d" | "quarter" | "all" | null;
  asAt?: Date;
}): AnalyticsPeriod | null {
  if (selection.period) {
    const previous = previousMonthKey(selection.period);
    return {
      mode: "month",
      currentKey: selection.period,
      comparisonKey: previous,
      currentLabel: selection.period,
      comparisonLabel: previous,
    };
  }
  if (selection.quarter) {
    const previous = previousQuarterKey(selection.quarter);
    return {
      mode: "quarter",
      currentKey: selection.quarter,
      comparisonKey: previous,
      currentLabel: selection.quarter,
      comparisonLabel: previous,
    };
  }
  if (selection.range === "30d" && selection.asAt) {
    const currentEnd = selection.asAt;
    const previousEnd = new Date(currentEnd.getTime() - 30 * 86_400_000);
    return {
      mode: "30d",
      currentKey: currentEnd.toISOString(),
      comparisonKey: previousEnd.toISOString(),
      currentLabel: "Last 30 days",
      comparisonLabel: "Previous 30 days",
    };
  }
  if (selection.range === "all" && selection.asAt) {
    const previous = new Date(selection.asAt);
    previous.setUTCFullYear(previous.getUTCFullYear() - 1);
    return {
      mode: "year",
      currentKey: selection.asAt.toISOString(),
      comparisonKey: previous.toISOString(),
      currentLabel: "Year to date",
      comparisonLabel: "Same period last year",
    };
  }
  return null;
}

export function compareMetric(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null) return { current: current ?? null, previous: previous ?? null, delta: null, deltaPct: null };
  const delta = current - previous;
  return {
    current,
    previous,
    delta,
    deltaPct: previous === 0 ? (current === 0 ? 0 : null) : Number(((delta / Math.abs(previous)) * 100).toFixed(1)),
  };
}

export function classifyAnalyticsMetric(metric: string): { workloadClass: AnalyticsWorkloadClass; rationale: string } {
  const key = metric.toLowerCase();
  if (key.includes("monthly_cash_freed") || key.includes("creditor") || key.includes("financial_problems_resolved") || key.includes("income_band")) {
    return { workloadClass: "SOURCE_AGGREGATE", rationale: "Large historical aggregation can be calculated from governed source reporting views." };
  }
  if (key.includes("audit") || key.includes("security") || key.includes("compliance") || key.includes("session")) {
    return { workloadClass: "POSTGRES_READ_MODEL", rationale: "Application-owned governance and audit data belongs in PostgreSQL." };
  }
  return { workloadClass: "HYBRID", rationale: "Keep the curated read model while permitting approved source aggregates for heavy reporting." };
}
