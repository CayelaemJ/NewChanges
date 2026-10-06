// ════════════════════════════════════════════════════════════════════
//  AUTHORITATIVE DAILY REFRESH
//
//  Every day at 00:00 Africa/Johannesburg the portal:
//    1. marks the dashboard as REBUILDING,
//    2. purges source-derived dashboard facts/caches,
//    3. clears integration cursors so every report reloads from since=null,
//    4. reloads all canonical source rows from since=null as an authoritative
//       overwrite (previous cursors, MLOps decisions and stale-write checks do
//       not gate this rebuild),
//    5. rebuilds dashboard snapshots before publishing the new dataset.
//
//  Identity/configuration anchors (users, employer links, partner branding,
//  report schedules, score configuration and separately sourced chat history)
//  are deliberately preserved by purgeDashboardDataForFullRefresh().
// ════════════════════════════════════════════════════════════════════

import cron from "node-cron";
import { Client } from "pg";
import { runSync, testConnection } from "./syncService.js";
import { purgeDashboardDataForFullRefresh } from "./importService.js";
import { capturePublishedDashboardState, prisma } from "./snapshotBuilder.js";
import { LOAD_ORDER } from "./reportFormats.js";

const REFRESH_TIMEZONE = process.env.DAILY_REFRESH_TIMEZONE ?? "Africa/Johannesburg";
let activeFullRefresh: Promise<any> | null = null;

// PostgreSQL advisory locks are shared across Railway replicas. Without this,
// two app instances receiving the same midnight cron tick could both purge and
// reload the live dataset. Keep this key stable for this one global operation.
const FULL_REFRESH_LOCK_A = 0x454653; // "EFS"
const FULL_REFRESH_LEADER_LOCK_B = 78;
const SOURCE_SYNC_COORDINATION_LOCK_B = 79;

async function openFullRefreshLease() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for the full-refresh database lease.");

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [FULL_REFRESH_LOCK_A, FULL_REFRESH_LEADER_LOCK_B],
    );
    const acquired = Boolean(result.rows?.[0]?.acquired);
    if (!acquired) {
      await client.end();
      return null;
    }
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}

async function acquireSourceSyncExclusiveLease(client: Client) {
  // REBUILDING is set before this wait, so no new normal sync can progress.
  // Poll instead of waiting forever: a wedged source sync must fail the
  // pre-purge stage rather than leave the dashboard permanently rebuilding.
  for (let attempt = 0; attempt < 120; attempt++) {
    const result = await client.query(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [FULL_REFRESH_LOCK_A, SOURCE_SYNC_COORDINATION_LOCK_B],
    );
    if (Boolean(result.rows?.[0]?.acquired)) return;
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  throw new Error("Timed out waiting for an existing source sync to release the full-refresh coordination lease.");
}

async function closeFullRefreshLease(client: Client | null) {
  if (!client) return;
  try {
    await client.query(
      "SELECT pg_advisory_unlock($1, $2)",
      [FULL_REFRESH_LOCK_A, SOURCE_SYNC_COORDINATION_LOCK_B],
    ).catch(() => {});
    await client.query(
      "SELECT pg_advisory_unlock($1, $2)",
      [FULL_REFRESH_LOCK_A, FULL_REFRESH_LEADER_LOCK_B],
    ).catch(() => {});
  } finally {
    await client.end().catch(() => {});
  }
}

function sumCounts(counts: Record<string, number> | undefined, includeShells = false) {
  if (!counts) return 0;
  return Object.entries(counts).reduce((total, [key, value]) => {
    if (!includeShells && key.endsWith("Shells")) return total;
    return total + (Number(value) || 0);
  }, 0);
}

function committedRows(summary: Record<string, any> | undefined) {
  if (!summary) return 0;
  return Object.values(summary).reduce((total, item: any) => total + (Number(item?.committed) || 0), 0);
}

function syncFailureReason(syncResult: any): string {
  const failures = Object.entries(syncResult?.summary ?? {})
    .filter(([, value]: any) => value?.error)
    .slice(0, 5)
    .map(([reportKey, value]: any) => `${reportKey}: ${String(value.error)}`);
  if (failures.length) return failures.join(" | ");
  return String(syncResult?.error ?? syncResult?.note ?? `status ${syncResult?.status ?? "UNKNOWN"}`);
}

async function setRefreshState(status: string, note: string, at = new Date(), successful = false) {
  await prisma.integrationConfig.upsert({
    where: { id: "default" },
    create: {
      id: "default",
      lastSyncAt: at,
      lastSyncStatus: status,
      lastSyncNote: note,
      ...(successful ? { lastSuccessfulSyncAt: at } : {}),
    },
    update: {
      lastSyncAt: at,
      lastSyncStatus: status,
      lastSyncNote: note,
      ...(successful ? { lastSuccessfulSyncAt: at } : {}),
    },
  });
}

async function runAuthoritativeFullRefresh(reason: "scheduled" | "manual" | "reset") {
  if (activeFullRefresh) return activeFullRefresh;

  activeFullRefresh = (async () => {
    const startedAt = new Date();
    let purgeResult: any = null;
    let lease: Client | null = null;

    try {
      lease = await openFullRefreshLease();
      if (!lease) {
        return {
          ok: true,
          status: "ALREADY_RUNNING",
          skipped: true,
          fullRefresh: true,
          refreshType: "PURGE_AND_OVERWRITE",
          timezone: REFRESH_TIMEZONE,
          note: "Another application replica already owns the authoritative full-refresh lease.",
        };
      }
      // Never destroy the currently published dashboard merely because the
      // source is unreachable or its canonical SQL views are malformed.
      // SQL preflight validates every LOAD_ORDER view; API preflight verifies
      // the configured source endpoint before the destructive phase begins.
      const preflight: any = await testConnection();
      if (!preflight?.ok) {
        throw new Error(preflight?.error ?? preflight?.note ?? "Source preflight failed.");
      }

      await setRefreshState(
        "REBUILDING",
        `Full refresh started (${reason}). Source preflight passed; waiting for any active source sync before the purge/reload begins.`,
        startedAt,
      );
      await acquireSourceSyncExclusiveLease(lease);
      await setRefreshState(
        "REBUILDING",
        `Full refresh started (${reason}). Source preflight passed. The last successful dashboard remains published while the source data is rebuilt.`,
        startedAt,
      );

      // Power BI-style publish barrier: capture the current dashboard before
      // any destructive work. If this cannot be captured, abort before purge.
      await capturePublishedDashboardState();

      console.log(
        `[${startedAt.toISOString()}] Full dashboard refresh starting (${reason}, timezone: ${REFRESH_TIMEZONE})...`,
      );

      purgeResult = await purgeDashboardDataForFullRefresh();
      const syncResult: any = await runSync("full-refresh");

      if (!syncResult || syncResult.status !== "OK") {
        throw new Error(syncFailureReason(syncResult));
      }

      // Do not publish the newly rebuilt source tables until a complete,
      // renderable dashboard snapshot has been captured for every active employer.
      const published = await capturePublishedDashboardState();

      const finishedAt = new Date();
      const purged = sumCounts(purgeResult?.cleared);
      const overwritten = committedRows(syncResult?.summary);
      const rebuilt = Array.isArray(syncResult?.touchedEmployers) ? syncResult.touchedEmployers.length : 0;
      const note =
        `Full refresh completed and published: purged ${purged} source-derived dashboard rows, ` +
        `accepted and rewrote ${overwritten} row(s) from the authoritative source, ignoring prior cursors/MLOps/staleness, ` +
        `rebuilt ${rebuilt} employer dashboard${rebuilt === 1 ? "" : "s"}, and published ` +
        `${published.captured} last-successful dashboard snapshot${published.captured === 1 ? "" : "s"}.`;

      // Close any older active data-quality warning in the Admin UI without
      // deleting audit history. These PASS markers mean "authoritative overwrite
      // intentionally bypassed the gate"; they are telemetry, not a gate.
      await prisma.mLOpsEvent.createMany({
        data: LOAD_ORDER.map((reportKey) => ({
          eventType: "DATA_QUALITY_GATE",
          modelKey: "data-quality",
          modelVersion: "authoritative-overwrite",
          status: "PASS",
          metadata: {
            reportKey,
            authoritativeOverwrite: true,
            bypassed: true,
            reason,
            refreshedAt: finishedAt.toISOString(),
          },
        })),
      });

      await setRefreshState("OK", note, finishedAt, true);
      console.log(`[${finishedAt.toISOString()}] ${note}`);

      return {
        ...syncResult,
        ok: true,
        fullRefresh: true,
        refreshType: "PURGE_AND_OVERWRITE",
        timezone: REFRESH_TIMEZONE,
        startedAt,
        finishedAt,
        purgedRows: purged,
        overwrittenRows: overwritten,
        rebuiltEmployers: rebuilt,
        publishedDashboards: published.captured,
        publishedAt: published.capturedAt,
        purge: purgeResult,
        note,
      };
    } catch (error: any) {
      const finishedAt = new Date();
      const purged = sumCounts(purgeResult?.cleared);
      const message = error?.message ?? String(error);
      const note = purgeResult
        ? `Full refresh failed after purging ${purged} source-derived dashboard rows. The last successful dashboard remains published. Reason: ${message}`
        : `Full refresh preflight failed before any dashboard data was purged. The current dashboard remains published. Reason: ${message}`;
      const failureStatus = purgeResult ? "FULL_REFRESH_FAILED" : "FULL_REFRESH_PRECHECK_FAILED";

      await setRefreshState(failureStatus, note, finishedAt, false).catch(() => {});
      console.error(`[${finishedAt.toISOString()}] ${note}`);
      throw error;
    } finally {
      await closeFullRefreshLease(lease);
      activeFullRefresh = null;
    }
  })();

  return activeFullRefresh;
}

async function refreshWithRetry(label: string, fn: () => Promise<any>) {
  let lastError: any;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      console.error(
        `[${new Date().toISOString()}] ${label} attempt ${attempt}/3 failed:`,
        error?.message ?? error,
      );
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 60_000));
      }
    }
  }
  throw lastError;
}

export function startDailyRefresh() {
  const schedule = process.env.DAILY_REFRESH_CRON ?? "0 0 * * *";
  if ((process.env.DAILY_REFRESH_MODE ?? "app").toLowerCase() === "sqlproc") {
    console.warn(
      "DAILY_REFRESH_MODE=sqlproc is ignored for the authoritative daily refresh; the validated app pipeline is required so every configured report is reloaded.",
    );
  }

  cron.schedule(
    schedule,
    async () => {
      try {
        await refreshWithRetry("Daily full source refresh", () => runAuthoritativeFullRefresh("scheduled"));
      } catch (error: any) {
        console.error(
          `[${new Date().toISOString()}] Daily full refresh failed after retries:`,
          error?.message ?? error,
        );
      }
    },
    { timezone: REFRESH_TIMEZONE },
  );

  console.log(`Daily authoritative refresh scheduled (${schedule}, timezone: ${REFRESH_TIMEZONE}, mode: purge+overwrite)`);
}

// Manual trigger — wired to POST /api/admin/integration/refresh (admin only).
// It deliberately runs the exact same purge+overwrite path as the midnight job.
export async function triggerRefreshNow(reason: "manual" | "reset" = "manual") {
  try {
    return await runAuthoritativeFullRefresh(reason);
  } catch (error: any) {
    const message = error?.message ?? String(error);
    console.error("Manual full refresh failed:", message);
    return { ok: false, status: "FULL_REFRESH_FAILED", error: message };
  }
}
