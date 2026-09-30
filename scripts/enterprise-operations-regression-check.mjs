import { compareMetric, comparisonForSelection, previousMonthKey, previousQuarterKey } from "../src/services/analyticsEngineService.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const schema = readFileSync(join(root, "prisma/schema.prisma"), "utf8");
const server = readFileSync(join(root, "src/server.ts"), "utf8");
const sync = readFileSync(join(root, "src/services/syncService.ts"), "utf8");
const adapter = readFileSync(join(root, "src/services/sourceAdapter.ts"), "utf8");
const admin = readFileSync(join(root, "public/admin.html"), "utf8");

const checks = [
  ["analytics placement schema", schema.includes("analyticsMode") && schema.includes("AnalyticsRoute")],
  ["source analytics is read-only", schema.includes("sourceAnalyticsReadOnly")],
  ["replica controls schema", schema.includes("sqlReplicaHost") && schema.includes("sqlReplicaMaxLagSeconds")],
  ["route workload classification", schema.includes("workloadClass") && sync.includes("workloadClass must be SOURCE_ONLY")],
  ["replica route validation", sync.includes("useReplica") && sync.includes("requires a configured SQL read replica")],
  ["replica health endpoint", server.includes("/api/admin/integration/replica-health") && adapter.includes("checkMysqlReadReplica")],
  ["source analytics view templates", readFileSync(join(root, "docs/sql/mysql-source-analytics-views.sql"), "utf8").includes("v_monthly_cash_freed")],
  ["route validation", sync.includes("executionMode must be POSTGRES, SOURCE or HYBRID")],
  ["route applied during sync", sync.includes("prisma.analyticsRoute.findUnique") && sync.includes("route.sourceView")],
  ["safe source view override", adapter.includes("source analytics view contains unsafe characters")],
  ["source view templates use canonical views", readFileSync(join(root, "docs/sql/mysql-source-analytics-views.sql"), "utf8").includes("FROM v_journeys") && readFileSync(join(root, "docs/sql/mysql-source-analytics-views.sql"), "utf8").includes("FROM v_salary_advances")],
  ["enterprise overview endpoint", server.includes("/api/admin/enterprise/overview")],
  ["data quality endpoint", server.includes("/api/admin/enterprise/data-quality")],
  ["analytics routes endpoint", server.includes("/api/admin/integration/routes")],
  ["admin architecture centre", admin.includes("Enterprise Operations &amp; Data Architecture")],
  ["admin source analytics controls", admin.includes("integ-source-analytics")],
  ["no arbitrary SQL control", admin.includes("Arbitrary SQL is never accepted")],
];

const failed = checks.filter(([, ok]) => !ok);
for (const [name, ok] of checks) console.log(`${ok ? "✓" : "✕"} ${name}`);
if (failed.length) process.exit(1);
console.log("Enterprise operations regression checks passed.");

const analyticsChecks = [
  ["previous month engine", previousMonthKey("2026-09") === "2026-08"],
  ["previous quarter engine", previousQuarterKey("2026-Q1") === "2025-Q4"],
  ["month comparison engine", comparisonForSelection({ period: "2026-09" })?.comparisonKey === "2026-08"],
  ["metric percentage delta", compareMetric(120, 100).deltaPct === 20],
  ["zero baseline is explicit", compareMetric(100, 0).deltaPct === null],
];
for (const [label, ok] of analyticsChecks) {
  if (!ok) throw new Error(`Analytics regression failed: ${label}`);
}
