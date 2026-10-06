import { readFileSync } from "node:fs";

const read = (path) => readFileSync(path, "utf8");
const daily = read("src/services/dailyRefresh.ts");
const sync = read("src/services/syncService.ts");
const imports = read("src/services/importService.ts");
const snapshots = read("src/services/snapshotBuilder.ts");
const reports = read("src/services/reportScheduler.ts");
const server = read("src/server.ts");
const dashboard = read("public/dashboard.html");
const sourceAdapter = read("src/services/sourceAdapter.ts");
const admin = read("public/admin.html");
const users = read("public/users.html");
const sourceStatus = read("public/admin-source-status.js");

const failures = [];
const must = (ok, message) => { if (!ok) failures.push(message); };

must(daily.includes('process.env.DAILY_REFRESH_CRON ?? "0 0 * * *"'), "daily refresh must default to 00:00");
must(daily.includes('process.env.DAILY_REFRESH_TIMEZONE ?? "Africa/Johannesburg"'), "daily refresh must default to Africa/Johannesburg");
must(daily.includes('{ timezone: REFRESH_TIMEZONE }'), "node-cron must receive the explicit refresh timezone");

const preflightAt = daily.indexOf("await testConnection()");
const rebuildingAt = daily.indexOf('await setRefreshState(\n        "REBUILDING"');
const purgeAt = daily.indexOf("await purgeDashboardDataForFullRefresh()");
const reloadAt = daily.indexOf('await runSync("full-refresh")');
must(preflightAt >= 0 && rebuildingAt > preflightAt && purgeAt > rebuildingAt && reloadAt > purgeAt, "full refresh order must be preflight -> rebuilding state -> purge -> authoritative reload");

must(daily.includes("FULL_REFRESH_PRECHECK_FAILED"), "a failed preflight must be distinguishable from a post-purge failure");
must(daily.includes("FULL_REFRESH_FAILED"), "a failure after purge must preserve the last published dashboard while recording failure state");
must(daily.includes("PURGE_AND_OVERWRITE"), "refresh result must identify purge-and-overwrite mode");
must(daily.includes("pg_try_advisory_lock") && daily.includes("FULL_REFRESH_LEADER_LOCK_B"), "daily refresh must elect one database-backed leader across replicas");
must(daily.includes("SOURCE_SYNC_COORDINATION_LOCK_B") && daily.includes("acquireSourceSyncExclusiveLease"), "daily refresh must exclude ordinary source syncs during purge/reload");

const purgeStart = imports.indexOf("export async function purgeDashboardDataForFullRefresh()");
const resetStart = imports.indexOf("export async function resetAllData()");
const purgeBody = purgeStart >= 0 && resetStart > purgeStart ? imports.slice(purgeStart, resetStart) : "";
must(purgeBody.includes("tx.employee.updateMany") && purgeBody.includes("tx.employer.updateMany"), "authoritative purge must preserve employee/employer identity shells");
must(!purgeBody.includes("tx.employee.deleteMany") && !purgeBody.includes("tx.employer.deleteMany"), "authoritative purge must not cascade-delete identity/configuration anchors");
must(!purgeBody.includes("tx.chatSession.deleteMany"), "separate chat history must survive the core daily purge");
must(!purgeBody.includes("tx.dashboardCohortCache.deleteMany"), "the published dashboard cache must survive destructive source refreshes");
must(purgeBody.includes("reportKey: { in: LOAD_ORDER }"), "source batches/cursors must be scoped to canonical source feeds");
must(snapshots.includes('PUBLISHED_DASHBOARD_CACHE_KEY = "__published_dashboard_v1__"'), "snapshot builder must persist a dedicated last-successful dashboard");
must(snapshots.includes("capturePublishedDashboardState") && snapshots.includes("getPublishedDashboardPayload"), "snapshot builder must capture and serve the published dashboard layer");
must(snapshots.includes("cacheKey: { not: PUBLISHED_DASHBOARD_CACHE_KEY }"), "snapshot rebuilds must invalidate working caches without deleting the published fallback");

must(sync.includes('trigger: "manual" | "scheduled" | "full-refresh"'), "sync pipeline must expose an explicit full-refresh trigger");
must(sync.includes('const authoritativeOverwrite = trigger === "full-refresh"'), "full refresh must explicitly enter authoritative overwrite mode");
must(sync.includes('const requestSince = authoritativeOverwrite ? null'), "authoritative overwrite must always read the source from the beginning, regardless of old cursors");
must(sync.includes('through: authoritativeOverwrite ? undefined : throughAt'), "authoritative overwrite must remove the through timestamp too, so Reset rereads the entire connected source without any time-window filter");
must(sync.includes('authoritativeOverwrite && sourceTotalRows != null && sourceTotalRows > 0 && pulled.records.length === 0'), "authoritative rebuild must reject a false 0-row extraction when the connected SQL source view actually contains rows");
must(sync.includes('authoritativeOverwrite\n          ? { status: "PASS"') && sync.includes('BYPASSED_AUTHORITATIVE_OVERWRITE'), "authoritative overwrite must bypass MLOps gating rather than inherit prior decisions");
must(sync.includes('commitSyncRows(reportKey, result.rows as Record<string, any>[], reportProgress, { authoritativeOverwrite })'), "bulk writes must receive authoritative overwrite semantics");
must(sync.includes('authoritative: authoritativeOverwrite'), "authoritative source extraction must be explicitly requested");
must(sourceAdapter.includes('const extractionPageSize = intSetting(config.sqlMaxRowsPerReport, 50_000, 1_000, 250_000)'), "SQL extraction must use a bounded page size rather than a total-feed row cap");
must(sourceAdapter.includes('while (true)') && sourceAdapter.includes('offset += page.rows.length'), "large SQL feeds must continue page-by-page instead of failing at a fixed total row count");
must(!sourceAdapter.includes('SQL extraction exceeded the configured'), "ordinary SQL sync must not reject a feed merely because its total row count exceeds one extraction page");
must(sourceAdapter.includes('OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY'), "MSSQL extraction must support bounded pagination");
must(sourceAdapter.includes('OFFSET ?'), "MySQL extraction must support bounded pagination");
must(sourceAdapter.includes("SOURCE_CONFIG_LOCKED") && sourceAdapter.includes("effectiveSourceConfig"), "admin-selected source settings must be able to become the effective runtime database unless explicit environment locking is enabled");
must(sync.includes("effectiveSqlDatabase") && sync.includes('lastSyncStatus: "PROCESSING"'), "admin status must expose the effective database and publish an in-flight sync state");
must(admin.includes("/static/admin-source-status.js") && dashboard.includes("/static/admin-source-status.js") && users.includes("/static/admin-source-status.js"), "admin-only connected-source status must be present on Admin, Dashboard and Users");
must(sourceStatus.includes("/api/admin/integration") && sourceStatus.includes("Connected source:") && sourceStatus.includes("COMPLETE"), "source status widget must use the protected admin integration endpoint and make completion explicit");
must(admin.includes('Reset always reloads.') && !admin.includes('id="reset-then-sync"'), "Reset UI must always reload from source and must not offer an optional sync checkbox");
must(imports.includes('options.authoritativeOverwrite || historicalObservationFeed ? 0 : projectionOnly'), "authoritative overwrite must not report source rows as stale skips");
must(server.includes('triggerRefreshNow("reset")') && !server.includes('const result = await resetAllData()'), "Reset must be a single authoritative reset+reload operation, never a raw clear followed by optional sync");
must(daily.includes('modelVersion: "authoritative-overwrite"') && daily.includes('bypassed: true'), "successful authoritative refresh must close older active MLOps warnings without deleting audit history");
must(sync.includes('isFirstSync && trigger !== "full-refresh"'), "authoritative reload must accept a legitimately empty source feed");
must(sync.includes('if (trigger === "full-refresh")') && sync.includes("await snapshotEmployer(employerId)"), "full refresh must rebuild snapshots before reporting success");
must(sync.includes('if (trigger !== "full-refresh")') && sync.includes("The authoritative full-refresh wrapper owns publication state"), "low-level full sync must not publish raw rebuild state before the dashboard barrier succeeds");
must(sync.includes("pg_try_advisory_lock_shared") && sync.includes("SOURCE_SYNC_COORDINATION_LOCK_B"), "ordinary source syncs must share the database coordination lock");

must(reports.includes('"REBUILDING", "PARTIAL", "FAILED", "FULL_REFRESH_FAILED", "FULL_REFRESH_PRECHECK_FAILED"'), "scheduled/manual report delivery must reject rebuilding, partial or failed source data");
must(reports.includes("scheduled reports deferred until dashboard data is publishable"), "due schedules must be deferred without being claimed while refresh data is unpublished");

must(server.includes('"REBUILDING", "PARTIAL", "FAILED", "FULL_REFRESH_FAILED", "FULL_REFRESH_PRECHECK_FAILED"'), "dashboard API must fall back to the last successful publish for rebuilding, partial and failed source states");
must(server.includes("getPublishedDashboardPayload") && server.includes("servingLastSuccessful: true"), "dashboard API must serve the last-successful published snapshot instead of replacing the dashboard on refresh failure");
must(server.includes("sendPublishedDashboardUnavailable") && server.includes('reply.code(503)'), "a 503 is allowed only when no published fallback exists");
must(dashboard.includes("Purging & rebuilding") && dashboard.includes("Purged & overwritten"), "dashboard must visibly distinguish rebuilding from a completed purge-and-overwrite refresh");
must(dashboard.includes("still showing the last successful data") && dashboard.includes("Reason:"), "dashboard must preserve charts and surface the refresh failure reason");

if (failures.length) {
  console.error("Daily refresh regression check failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Daily refresh regression check passed: authoritative reset/refresh ignores prior cursors/MLOps/staleness, reloads from source truth, and preserves Power BI-style last-successful publishing.");
