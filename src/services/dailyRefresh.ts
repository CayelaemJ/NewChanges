// ════════════════════════════════════════════════════════════════════
//  AUTHORITATIVE DAILY REFRESH
//
//  Every day at 00:00 Africa/Johannesburg the portal:
//    1. marks the dashboard as REBUILDING,
//    2. purges source-derived dashboard facts/caches,
//    3. clears integration cursors so every report reloads from since=null,
//    4. runs the normal validated/MLOps-protected source pipeline,
//    5. rebuilds dashboard snapshots before publishing the new dataset.
//
//  Identity/configuration anchors (users, employer links, partner branding,
//  report schedules, score configuration and separately sourced chat history)
//  are deliberately preserved by purgeDashboardDataForFullRefresh().
// ════════════════════════════════════════════════════════════════════

import cron from "node-cron";
import { runSync, testConnection } from "./syncService.js";
import { purgeDashboardDataForFullRefresh } from "./importService.js";
import { prisma } from "./snapshotBuilder.js";

const REFRESH_TIMEZONE = process.env.DAILY_REFRESH_TIMEZONE ?? "Africa/Johannesburg";
let activeFullRefresh: Promise<any> | null = null;

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

async function runAuthoritativeFullRefresh(reason: "scheduled" | "manual") {
  if (activeFullRefresh) return activeFullRefresh;

  activeFullRefresh = (async () => {
    const startedAt = new Date();
    let purgeResult: any = null;

    try {
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
        `Full refresh started (${reason}). Source preflight passed; existing dashboard facts are being purged before the authoritative source is reloaded.`,
        startedAt,
      );

      console.log(
        `[${startedAt.toISOString()}] Full dashboard refresh starting (${reason}, timezone: ${REFRESH_TIMEZONE})...`,
      );

      purgeResult = await purgeDashboardDataForFullRefresh();
      const syncResult: any = await runSync("full-refresh");

      if (!syncResult || syncResult.status !== "OK") {
        throw new Error(
          syncResult?.error
            ?? syncResult?.note
            ?? `Full source reload finished with status ${syncResult?.status ?? "UNKNOWN"}.`,
        );
      }

      const finishedAt = new Date();
      const purged = sumCounts(purgeResult?.cleared);
      const overwritten = committedRows(syncResult?.summary);
      const rebuilt = Array.isArray(syncResult?.touchedEmployers) ? syncResult.touchedEmployers.length : 0;
      const note =
        `Full refresh completed: purged ${purged} source-derived dashboard rows, ` +
        `overwrote them from the authoritative source (${overwritten} rows committed), ` +
        `and rebuilt ${rebuilt} employer dashboard${rebuilt === 1 ? "" : "s"}.`;

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
        purge: purgeResult,
        note,
      };
    } catch (error: any) {
      const finishedAt = new Date();
      const purged = sumCounts(purgeResult?.cleared);
      const message = error?.message ?? String(error);
      const note = purgeResult
        ? `Full refresh failed after purging ${purged} source-derived dashboard rows: ${message}`
        : `Full refresh preflight failed before any dashboard data was purged: ${message}`;
      const failureStatus = purgeResult ? "FULL_REFRESH_FAILED" : "FULL_REFRESH_PRECHECK_FAILED";

      await setRefreshState(failureStatus, note, finishedAt, false).catch(() => {});
      console.error(`[${finishedAt.toISOString()}] ${note}`);
      throw error;
    } finally {
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
export async function triggerRefreshNow() {
  try {
    return await runAuthoritativeFullRefresh("manual");
  } catch (error: any) {
    const message = error?.message ?? String(error);
    console.error("Manual full refresh failed:", message);
    return { ok: false, status: "FULL_REFRESH_FAILED", error: message };
  }
}
