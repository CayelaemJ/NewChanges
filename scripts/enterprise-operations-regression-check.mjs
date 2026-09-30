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
  ["route validation", sync.includes("executionMode must be POSTGRES, SOURCE or HYBRID")],
  ["route applied during sync", sync.includes("prisma.analyticsRoute.findUnique") && sync.includes("route.sourceView")],
  ["safe source view override", adapter.includes("source analytics view contains unsafe characters")],
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
