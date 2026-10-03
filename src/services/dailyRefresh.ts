// ════════════════════════════════════════════════════════════════════
//  DAILY LIVE REFRESH — keeps the portal a live mirror of the source DB.
//
//  Default mode reuses the app's own validated sync pipeline
//  (runSync("scheduled")) — pull every report from the configured
//  API/SQL source and commit through the normal import path.
//
//  Optional mode DAILY_REFRESH_MODE=sqlproc instead calls the server-side
//  PostgreSQL procedure refresh_all_reports() every night
//  (src/migrations/004-daily-refresh.sql) — an in-database truncate +
//  reload from FDW-mounted source views. Use that only when the source
//  views are mounted in the `source` schema of the portal database.
// ════════════════════════════════════════════════════════════════════

import cron from "node-cron";
import { runSync } from "./syncService.js";
import { prisma } from "./snapshotBuilder.js";

async function refreshViaAppPipeline() {
  console.log(`[${new Date().toISOString()}] Daily refresh (app pipeline) starting...`);
  const result = await runSync("scheduled");
  console.log(`[${new Date().toISOString()}] Daily refresh finished: ${result.status} — ${result.note}`);
  return result;
}

async function refreshViaDbProcedure() {
  const found = await prisma.$queryRawUnsafe(
    `SELECT to_regprocedure('refresh_all_reports(text,text)') AS p`,
  );
  if (!(found as any[])?.[0]?.p) {
    throw new Error("refresh_all_reports(text,text) not found — run: node scripts/apply-sync-migrations.mjs");
  }
  await prisma.$executeRawUnsafe(
    `CALL refresh_all_reports($1, $2)`,
    process.env.SOURCE_FDW_SCHEMA ?? "source",
    process.env.SOURCE_SQL_VIEW_PREFIX ?? "v_",
  );
  return { ok: true, status: "OK", note: "refresh_all_reports() completed" };
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
  const schedule = process.env.DAILY_REFRESH_CRON ?? "0 0 * * *"; // 00:00 server time, daily
  const useSqlProc = (process.env.DAILY_REFRESH_MODE ?? "app") === "sqlproc";

  cron.schedule(schedule, async () => {
    try {
      if (useSqlProc) {
        await refreshWithRetry("Daily DB refresh", refreshViaDbProcedure);
      } else {
        await refreshWithRetry("Daily source sync", refreshViaAppPipeline);
      }
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] Daily refresh failed:`, error?.message ?? error);
    }
  });

  console.log(`Daily live refresh scheduled (${schedule}, mode: ${useSqlProc ? "sqlproc" : "app"})`);
}

// Manual trigger — wired to POST /api/admin/integration/refresh (admin only).
export async function triggerRefreshNow() {
  try {
    const useSqlProc = (process.env.DAILY_REFRESH_MODE ?? "app") === "sqlproc";
    const result = useSqlProc ? await refreshViaDbProcedure() : await refreshViaAppPipeline();
    return { ...result };
  } catch (error: any) {
    const message = error?.message ?? String(error);
    console.error("Manual refresh failed:", message);
    return { ok: false, error: message };
  }
}
