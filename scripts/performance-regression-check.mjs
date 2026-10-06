import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const dashboard = fs.readFileSync(path.join(root, "public/dashboard.html"), "utf8");
const css = fs.readFileSync(path.join(root, "public/dashboard.css"), "utf8");
const failures = [];
const must = (ok, msg) => { if (!ok) failures.push(msg); };

const dashboardKb = Buffer.byteLength(dashboard, "utf8") / 1024;
const cssKb = Buffer.byteLength(css, "utf8") / 1024;

must(dashboardKb < 900, `dashboard.html is ${dashboardKb.toFixed(0)} KB; keep the initial document under 900 KB`);
must(cssKb < 450, `dashboard.css is ${cssKb.toFixed(0)} KB; keep the canonical stylesheet under 450 KB`);
must(/function safeRender/.test(dashboard), "dashboard visuals must be isolated behind safeRender");
must(/cache:s*['"]no-store['"]/.test(dashboard), "live dashboard fetches must explicitly avoid stale financial payloads");
const snapshotSource=fs.readFileSync(path.join(root, "src/services/snapshotBuilder.ts"), "utf8");
const importSource=fs.readFileSync(path.join(root, "src/services/importService.ts"), "utf8");
const syncSource=fs.readFileSync(path.join(root, "src/services/syncService.ts"), "utf8");
const sourceAdapter=fs.readFileSync(path.join(root, "src/services/sourceAdapter.ts"), "utf8");
const deployDb=fs.readFileSync(path.join(root, "scripts/deploy-db.mjs"), "utf8");
const syncMigrations=fs.readFileSync(path.join(root, "scripts/apply-sync-migrations.mjs"), "utf8");
const dockerfile=fs.readFileSync(path.join(root, "Dockerfile"), "utf8");
const server=fs.readFileSync(path.join(root, "src/server.ts"), "utf8");
const admin=fs.readFileSync(path.join(root, "public/admin.html"), "utf8");
must(snapshotSource.includes("dashboardCache") && snapshotSource.includes("DASHBOARD_CACHE_TTL_MS"), "dashboard should use a bounded server-side cohort cache");
must(importSource.includes("SYNC_BULK_CHUNK_SIZE") && importSource.includes("20000") && importSource.includes("sync_upsert_employers"), "large source syncs must use the set-based bulk upsert engine with a high-throughput default chunk");
must(deployDb.includes("001-sync-upsert-procedures.sql") && deployDb.includes("refusing to deploy the slow fallback as the default"), "deployments must install the bulk sync procedures instead of silently shipping the slow 1k-row fallback");
must(syncMigrations.includes('"src", "Migrations"') && syncMigrations.includes("existsSync"), "sync migration installer must resolve the repository's case-sensitive Linux migration path");
must(dockerfile.includes("/app/src/Migrations ./src/Migrations"), "Railway runtime image must include the server-side sync SQL migrations used by pre-deploy");
must(sourceAdapter.includes("watermark?(reportKey") && (sourceAdapter.match(/MAX\(source_updated_at\)/g)||[]).length >= 6, "SQL adapters must expose cheap indexed source_updated_at watermark checks");
must(syncSource.includes("detectSourceChanges") && syncSource.includes("SOURCE_CHANGE_POLL_SECONDS") && syncSource.includes("lastSourceUpdatedAt: newestPulledAt"), "sync service must detect source changes and persist the real source watermark");
must(server.includes("Source database changes detected; running incremental sync") && server.includes("SOURCE_CHANGE_POLL_SECONDS"), "runtime scheduler must trigger incremental sync from detected SQL changes");
must(server.includes("_max: { lastSourceUpdatedAt: true }"), "dashboard versioning must advance only when the source watermark advances");
must(admin.includes("Live SQL change detection is active every") && admin.includes("Bulk writes process up to"), "Administration must explain change detection and bulk-write throughput");
must(dashboard.includes("setInterval(checkSourceVersion,30000)"), "visible dashboards must re-check the source version within 30 seconds");

if (failures.length) {
  console.error("PERFORMANCE REGRESSION CHECK FAILED:");
  failures.forEach(x => console.error(" - " + x));
  process.exit(1);
}
console.log("Performance regression checks passed.");
