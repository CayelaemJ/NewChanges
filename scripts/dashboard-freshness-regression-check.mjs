import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const sync = read("../src/services/syncService.ts");
const snapshot = read("../src/services/snapshotBuilder.ts");
const server = read("../src/server.ts");
const dashboard = read("../public/dashboard.html");

// Advancing the successful source-sync version before rebuilding snapshots
// leaves connected browsers presenting stale scores as if they were current.
assert(!sync.includes("setImmediate(() =>"), "Successful sync must not enqueue dashboard publication after completion");
assert(sync.includes("const result = await snapshotEmployer(employerId)"), "Recalculation must finish before a source sync reports success");
assert(sync.includes('await reportOperationalFailure("DASHBOARD_REFRESH")'), "Recalculation failures must be observable");
assert(sync.includes("lastSuccessfulSyncAt: finishedAt"), "Successful sync version must advance only after awaited snapshots");
assert(snapshot.includes("export function syncDashboardCacheVersion(version:"), "Server cache must follow durable published sync version");
assert(snapshot.includes("dashboardCache.clear()"), "Process-local dashboard cache must invalidate on a version change");
assert(server.includes("syncDashboardCacheVersion(publishedVersion)"), "Each app process must observe cross-instance version changes");
assert(server.includes("version: syncStatus.lastSuccessfulSyncAt"), "Browser version must be a successful sync, not a raw source cursor");
assert(!server.includes("_max: { lastSourceUpdatedAt: true }"), "Raw source cursors must not act as publication versions");
assert(dashboard.includes("setInterval(checkSourceVersion,30000)"), "Active dashboards must check for fresh data every 30 seconds");
assert(dashboard.includes("document.addEventListener('visibilitychange'"), "Returning tabs must recheck latest publication");
assert(dashboard.includes("__SOURCE_VERSION__=live.syncStatus.lastSuccessfulSyncAt"), "Initial payload must establish a publication baseline");

console.log("Dashboard publication/freshness and cross-instance invalidation checks passed.");
