// ════════════════════════════════════════════════════════════════════
//  EXTERNAL SOURCE SYNC — API OR DIRECT SQL
//
//  Direct insert to target database, bypassing the broken sync chain.
//  Supports MySQL, PostgreSQL, and MSSQL as sources.
// ════════════════════════════════════════════════════════════════════

import { PrismaClient, Prisma } from "@prisma/client";
import { LOAD_ORDER, getFormat } from "./reportFormats.js";
import { validate } from "./importParser.js";
import { snapshotEmployer } from "./snapshotBuilder.js";
import { notifyAdmins, notifyScoreChangeIfCurrentPeriod } from "./automationService.js";
import { commitBatch, commitSyncRows } from "./importService.js";
import { assessIncomingRows } from "./dataQualityService.js";
import { createSourceAdapter, configuredSourceMode, sourceIsConfigured } from "./sourceAdapter.js";
import { runMLOpsAssessment } from "./mlopsService.js";

const prisma = new PrismaClient();
type Json = Prisma.InputJsonValue;
const CURSOR_OVERLAP_MS = 5 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
const pendingSnapshotEmployers = new Set<string>();
let snapshotDrainScheduled = false;

function overlapCursor(value?: Date | null): Date | null {
  return value ? new Date(value.getTime() - CURSOR_OVERLAP_MS) : null;
}

export async function getConfig() {
  return prisma.integrationConfig.upsert({
    where: { id: "default" },
    create: { id: "default" },
    update: {},
  });
}

export interface IntegrationConfigPatch {
  enabled?: boolean;
  sourceMode?: string;
  baseUrl?: string | null;
  authToken?: string | null;
  scheduleHours?: number;
  sqlDialect?: string | null;
  sqlHost?: string | null;
  sqlPort?: number | null;
  sqlDatabase?: string | null;
  sqlSchema?: string | null;
  sqlUsername?: string | null;
  sqlPassword?: string | null;
  sqlSsl?: boolean;
  sqlTrustServerCertificate?: boolean;
  sqlViewPrefix?: string | null;
  sqlQueryTimeoutMs?: number;
  sqlMaxRowsPerReport?: number;
  analyticsMode?: string;
  sourceAnalyticsEnabled?: boolean;
  sourceAnalyticsReadOnly?: boolean;
  sourceAnalyticsUseReplica?: boolean;
  sourceAnalyticsNote?: string | null;
  sourceAnalyticsReplicaEnabled?: boolean;
  sourceAnalyticsReplicaHost?: string | null;
  sourceAnalyticsReplicaPort?: number | null;
  sourceAnalyticsReplicaDatabase?: string | null;
  sourceAnalyticsReplicaSchema?: string | null;
  sourceAnalyticsReplicaUsername?: string | null;
  sourceAnalyticsReplicaPassword?: string | null;
  sourceAnalyticsReplicaSsl?: boolean;
  sourceAnalyticsReplicaTrustServerCertificate?: boolean;
  sourceAnalyticsReplicaMaxLagSeconds?: number;
}

export async function saveConfig(patch: IntegrationConfigPatch) {
  const data: any = { ...patch };
  if (patch.authToken === "" || patch.authToken == null) delete data.authToken;
  if (patch.sqlPassword === "" || patch.sqlPassword == null) delete data.sqlPassword;
  if (patch.sourceMode) data.sourceMode = patch.sourceMode.toUpperCase();
  if (patch.sqlDialect) data.sqlDialect = patch.sqlDialect.toUpperCase();
  if (patch.analyticsMode) {
    const mode = patch.analyticsMode.toUpperCase();
    if (!["POSTGRES_READ_MODEL", "SOURCE_AGGREGATES", "HYBRID"].includes(mode)) throw new Error("analyticsMode must be POSTGRES_READ_MODEL, SOURCE_AGGREGATES or HYBRID.");
    data.analyticsMode = mode;
  }
  if (patch.sourceAnalyticsEnabled && patch.sourceAnalyticsReadOnly === false) throw new Error("Source analytics must remain read-only.");
  if (patch.sourceAnalyticsReadOnly === false) throw new Error("Source analytics must remain read-only.");
  data.sourceAnalyticsReadOnly = true;
  if (patch.sourceAnalyticsReplicaMaxLagSeconds != null) {
    const lag = Number(patch.sourceAnalyticsReplicaMaxLagSeconds);
    if (!Number.isInteger(lag) || lag < 0 || lag > 86400) throw new Error("sourceAnalyticsReplicaMaxLagSeconds must be between 0 and 86400 seconds.");
  }
  if (patch.sourceAnalyticsReplicaEnabled) {
    if (!patch.sourceAnalyticsReplicaHost && !process.env.SOURCE_SQL_REPLICA_HOST) throw new Error("A read replica host is required when source replica analytics is enabled.");
    if (!patch.sourceAnalyticsReplicaUsername && !process.env.SOURCE_SQL_REPLICA_USERNAME) throw new Error("A read replica username is required when source replica analytics is enabled.");
  }

  return prisma.integrationConfig.upsert({
    where: { id: "default" },
    create: { id: "default", ...data },
    update: data,
  });
}

export async function listAnalyticsRoutes() {
  return prisma.analyticsRoute.findMany({ orderBy: { reportKey: "asc" } });
}

export async function saveAnalyticsRoute(input: { reportKey: string; executionMode: string; workloadClass?: string; sourceView?: string | null; useReplica?: boolean; enabled?: boolean; rationale?: string | null }) {
  const mode = String(input.executionMode || "POSTGRES").toUpperCase();
  const workloadClass = String(input.workloadClass || (mode === "POSTGRES" ? "POSTGRES_READ_MODEL" : "SOURCE_AGGREGATE")).toUpperCase();
  if (!["POSTGRES", "SOURCE", "HYBRID"].includes(mode)) throw new Error("executionMode must be POSTGRES, SOURCE or HYBRID.");
  if (!["SOURCE_ONLY", "SOURCE_AGGREGATE", "POSTGRES_READ_MODEL", "HYBRID"].includes(workloadClass)) throw new Error("Invalid workloadClass.");
  if (mode === "SOURCE" && !input.sourceView) throw new Error("SOURCE routes require an approved source view.");
  if (input.sourceView && !/^[A-Za-z_][A-Za-z0-9_.]*$/.test(input.sourceView)) throw new Error("sourceView contains unsafe characters.");
  if (workloadClass === "POSTGRES_READ_MODEL" && mode !== "POSTGRES") throw new Error("POSTGRES_READ_MODEL workloads must execute in PostgreSQL.");
  if (mode === "POSTGRES" && input.useReplica) throw new Error("PostgreSQL routes cannot use a source replica.");
  if (input.useReplica && mode === "POSTGRES") throw new Error("Replica routing requires SOURCE or HYBRID execution.");
  return prisma.analyticsRoute.upsert({
    where: { reportKey: input.reportKey },
    create: { reportKey: input.reportKey, executionMode: mode, workloadClass, sourceView: input.sourceView || null, useReplica: Boolean(input.useReplica), enabled: input.enabled !== false, rationale: input.rationale || null },
    update: { executionMode: mode, workloadClass, sourceView: input.sourceView || null, useReplica: Boolean(input.useReplica), enabled: input.enabled !== false, rationale: input.rationale || null, lastVerifiedAt: new Date() },
  });
}

export function publicConfig(config: Awaited<ReturnType<typeof getConfig>>) {
  const { authToken, sqlPassword, sourceAnalyticsReplicaPassword, ...safe } = config as any;
  let effectiveSourceMode = "API";
  let configured = false;
  try {
    effectiveSourceMode = configuredSourceMode(config);
    configured = sourceIsConfigured(config);
  } catch {
    effectiveSourceMode = String(config.sourceMode ?? "API").toUpperCase();
  }
  return {
    ...safe,
    effectiveSourceMode,
    configured,
    hasToken: Boolean(process.env.SOURCE_API_TOKEN || authToken),
    hasSqlPassword: Boolean(process.env.SOURCE_SQL_PASSWORD || sqlPassword),
    sqlPasswordFromEnvironment: Boolean(process.env.SOURCE_SQL_PASSWORD),
    apiTokenFromEnvironment: Boolean(process.env.SOURCE_API_TOKEN),
  };
}

export async function runSync(trigger: "manual" | "scheduled" = "manual") {
  const config = await getConfig();
  let configured = false;
  try { configured = sourceIsConfigured(config); }
  catch (error: any) { return { ok: false, error: error?.message ?? String(error) }; }
  if (!configured) {
    const mode = configuredSourceMode(config);
    return { ok: false, error: mode === "SQL" ? "SQL source settings are incomplete." : "No API base URL configured." };
  }

  const throughAt = new Date();
  const log = await prisma.syncLog.create({ data: { trigger, status: "RUNNING", throughAt } });
  const summary: Record<string, any> = {};
  const touchedEmployers = new Set<string>();
  let anyFailed = false;
  let anyOk = false;
  let adapter: Awaited<ReturnType<typeof createSourceAdapter>> | null = null;

  try {
    adapter = await createSourceAdapter(config);

    for (const reportKey of LOAD_ORDER) {
      const format = getFormat(reportKey);
      if (!format) continue;

      const cursor = await prisma.integrationCursor.upsert({
        where: { reportKey },
        create: { reportKey, lastAttemptAt: new Date(), lastStatus: "RUNNING" },
        update: { lastAttemptAt: new Date(), lastStatus: "RUNNING", lastNote: null },
      });

      try {
        const isFirstSync = cursor.lastSourceUpdatedAt === null && cursor.lastSuccessAt === null;
        const requestSince = isFirstSync ? null : overlapCursor(cursor.lastSourceUpdatedAt);
        if (isFirstSync) {
          console.log(`[sync] ${reportKey}: first sync detected, loading all records without date filtering.`);
        }
        const route = await prisma.analyticsRoute.findUnique({ where: { reportKey } });
        const useSourceRoute = route?.enabled && (route.executionMode === "SOURCE" || route.executionMode === "HYBRID") && route.sourceView;
        if (useSourceRoute && configuredSourceMode(config) !== "SQL") {
          throw new Error(`Analytics route for ${reportKey} requires SQL source mode.`);
        }
        const pulled = await adapter.fetchReport(reportKey, {
          since: requestSince,
          through: throughAt,
        }, useSourceRoute ? route.sourceView : null, {
          useReplica: Boolean(useSourceRoute && (route.useReplica || config.sourceAnalyticsUseReplica)),
        });
        const result = validate(format, pulled.records);

        const skewCeiling = new Date(throughAt.getTime() + CLOCK_SKEW_TOLERANCE_MS);
        const genuinelyFutureRows = result.rows.filter((row: any) => row.source_updated_at > skewCeiling);
        if (genuinelyFutureRows.length) {
          throw new Error(`${reportKey}: ${genuinelyFutureRows.length} record(s) had source_updated_at more than ${CLOCK_SKEW_TOLERANCE_MS / 60000} minute(s) later than the requested through timestamp — check the source database's clock/timezone settings.`);
        }
        result.rows = result.rows.map((row: any) =>
          row.source_updated_at > throughAt ? { ...row, source_updated_at: throughAt } : row
        );

        if (!result.ok) {
          const note = `Validation failed: ${result.errors.length} cell error(s), ${result.missingColumns.length} required column(s) missing.`;
          summary[reportKey] = {
            source: pulled.location,
            pulled: pulled.records.length,
            committed: 0,
            errorCount: result.errors.length,
            missingColumns: result.missingColumns,
            unknownColumns: result.unknownColumns,
            errors: result.errors.slice(0, 20),
            note,
          };
          await prisma.integrationCursor.update({
            where: { reportKey },
            data: { lastStatus: "FAILED", lastNote: note },
          });
          anyFailed = true;
          continue;
        }

        if (result.rowCount === 0) {
          if (isFirstSync) {
            // A first sync that returns nothing is almost always a wrong
            // database/view, not "no data". Report exactly what was queried
            // instead of a false "OK", and leave the cursor unset.
            let detail = "";
            try {
              const d = adapter.describe ? await adapter.describe(reportKey) : null;
              if (d) {
                detail = d.totalRows > 0
                  ? ` The view holds ${d.totalRows} row(s), newest source_updated_at ${d.newest}, but none fell inside the requested window (through ${throughAt.toISOString()}). Check source_updated_at values/timezone.`
                  : ` The view is EMPTY here. Connected as database "${d.database}" (${d.location}). Is this the database you loaded the data into?`;
              }
            } catch (e: any) {
              detail = ` Could not inspect the view: ${e?.message ?? e}`;
            }
            const note = `First sync returned 0 rows for ${reportKey} from ${pulled.location}.${detail}`;
            await prisma.integrationCursor.update({ where: { reportKey }, data: { lastStatus: "FAILED", lastNote: note } });
            summary[reportKey] = { error: note, source: pulled.location, pulled: 0, committed: 0 };
            anyFailed = true;
            continue;
          }
          await prisma.integrationCursor.update({
            where: { reportKey },
            data: {
              lastSuccessAt: new Date(),
              lastSourceUpdatedAt: throughAt,
              lastStatus: "OK",
              lastNote: `No changed records in the requested window via ${adapter.mode}.`,
            },
          });
          summary[reportKey] = { source: pulled.location, pulled: 0, committed: 0, since: requestSince, through: throughAt };
          anyOk = true;
          continue;
        }

        // MLOps safety gate: external database/API rows must pass the same
        // anomaly controls as file uploads before any live-table procedure runs.
        const quality = await assessIncomingRows({ reportKey, rows: result.rows as Record<string, unknown>[] });
        if (quality.status !== "PASS") {
          const qualityErrors = quality.findings.map((f) => ({
            row: f.row ?? 0,
            column: f.field ?? "dataset",
            value: null,
            reason: `[MLOPS:${f.code}] ${f.message} Fix: ${f.action}`,
          }));
          const blockedBatch = await prisma.importBatch.create({
            data: {
              reportKey,
              filename: `${adapter.mode.toLowerCase()}-sync:${reportKey}`,
              fileFormat: adapter.mode.toLowerCase(),
              status: "FAILED",
              rowCount: result.rowCount,
              errorCount: qualityErrors.length,
              errors: ({ cellErrors: qualityErrors, missingColumns: [], unknownColumns: [] } as unknown as Json),
              uploadedBy: `${adapter.mode.toLowerCase()}-sync (${trigger})`,
              sourceSince: cursor.lastSourceUpdatedAt,
              sourceThrough: throughAt,
            },
          });
          const reason = quality.findings.slice(0, 3).map((f) => `${f.code}: ${f.message}`).join(" | ");
          await prisma.integrationCursor.update({
            where: { reportKey },
            data: { lastStatus: "FAILED", lastNote: `MLOps data-quality gate blocked this sync. ${reason}` },
          });
          await notifyAdmins({
            subject: `MLOps blocked live sync: ${reportKey}`,
            html: `<p>An incoming sync for <strong>${reportKey}</strong> was blocked by the MLOps data-quality gate.</p><p>No rows were written to live tables. Review the MLOps event log and correct the source data before retrying.</p>`,
            slackText: `:rotating_light: MLOps blocked live sync ${reportKey}. No rows were written to live tables; review the MLOps event log and correct the source data before retrying.`,
          }).catch(() => {});
          summary[reportKey] = { error: `MLOps data-quality gate blocked the sync: ${reason}`, source: pulled.location, pulled: result.rowCount, committed: 0, batchId: blockedBatch.id };
          continue;
        }

        // Fast sync path: keep a lightweight audit row, but do not copy the
        // validated rows into ImportBatch/ImportBatchRow only to read them back.
        // PostgreSQL performs the natural-key INSERT ... ON CONFLICT merge in
        // bounded bulk operations instead of one Prisma lookup/upsert per row.
        const syncTouchedEmployers = new Set<string>();
        for (const row of result.rows as Record<string, any>[]) {
          if (row.employer_ref) syncTouchedEmployers.add(String(row.employer_ref));
        }
        for (const employerId of syncTouchedEmployers) touchedEmployers.add(employerId);

        const batch = await prisma.importBatch.create({
          data: {
            reportKey,
            filename: `${adapter.mode.toLowerCase()}-sync:${reportKey}`,
            fileFormat: adapter.mode.toLowerCase(),
            status: "VALIDATED",
            rowCount: result.rowCount,
            errorCount: 0,
            uploadedBy: `${adapter.mode.toLowerCase()}-sync (${trigger})`,
            sourceSince: cursor.lastSourceUpdatedAt,
            sourceThrough: throughAt,
          },
        });
        let committed;
        try {
          committed = await commitSyncRows(reportKey, result.rows as Record<string, any>[]);
        } catch (error: any) {
          // Keep older deployments functional until the idempotent server-side
          // procedures are applied. New deployments should set
          // APPLY_SYNC_MIGRATIONS=true so the fast path is always used.
          const message = error?.message ?? String(error);
          if (!/function sync_upsert_.* does not exist/i.test(message)) throw error;
          await prisma.importBatch.update({ where: { id: batch.id }, data: { stagedRows: result.rows as Json } });
          committed = await commitBatch(batch.id, { recompute: false });
        }
        await prisma.importBatch.update({
          where: { id: batch.id },
          data: {
            status: "COMMITTED",
            committedAt: new Date(),
            insertedCount: committed.inserted,
            updatedCount: committed.updated,
            deletedCount: committed.deleted,
            employerRef: syncTouchedEmployers.size === 1 ? [...syncTouchedEmployers][0] : null,
          },
        });
        summary[reportKey] = {
          source: pulled.location,
          pulled: pulled.records.length,
          committed: result.rowCount,
          inserted: committed.inserted,
          updated: committed.updated,
          deleted: committed.deleted,
          staleSkipped: committed.skipped,
          since: requestSince,
          through: throughAt,
        };

        const previousCursor = cursor.lastSourceUpdatedAt;
        await prisma.integrationCursor.update({
          where: { reportKey },
          data: {
            lastSuccessAt: new Date(),
            lastSourceUpdatedAt: throughAt,
            lastStatus: "OK",
            lastNote: `${committed.inserted} inserted, ${committed.updated} updated, ${committed.deleted} deleted, ${committed.skipped} stale skipped via ${adapter.mode}.`,
          },
        });
        if (previousCursor && (committed.inserted > 0 || committed.updated > 0 || committed.deleted > 0)) {
          await notifyAdmins({
            subject: `Source database changes detected: ${reportKey}`,
            html: `<p>The connected source changed for <strong>${reportKey}</strong>.</p><p>${committed.inserted} inserted, ${committed.updated} updated and ${committed.deleted} deleted records were applied. Dashboard snapshots are being refreshed.</p>`,
            slackText: `:information_source: Source DB changes detected for ${reportKey}: +${committed.inserted} / ~${committed.updated} / -${committed.deleted}. Dashboard refresh queued.`,
          }).catch(() => {});
        }
        anyOk = true;
      } catch (error: any) {
        const note = error?.message ?? String(error);
        summary[reportKey] = { error: note, since: cursor.lastSourceUpdatedAt, through: throughAt };
        await prisma.integrationCursor.update({
          where: { reportKey },
          data: { lastStatus: "FAILED", lastNote: note },
        });
        anyFailed = true;
      }
    }
  } catch (error: any) {
    anyFailed = true;
    summary.source = { error: error?.message ?? String(error) };
  } finally {
    if (adapter) {
      try { await adapter.close(); }
      catch (error: any) { summary.sourceClose = { error: error?.message ?? String(error) }; anyFailed = true; }
    }
  }

  // Snapshot calculation is deliberately off the sync critical path. The
  // source tables are authoritative once the feed commits; rebuilding the
  // read model can therefore happen once per changed employer in the
  // background without keeping the sync transaction/request open.
  for (const employerId of touchedEmployers) pendingSnapshotEmployers.add(employerId);
  if (touchedEmployers.size && !snapshotDrainScheduled) {
    snapshotDrainScheduled = true;
    setImmediate(() => {
      void (async () => {
        try {
          while (pendingSnapshotEmployers.size) {
            const employerId = pendingSnapshotEmployers.values().next().value as string;
            pendingSnapshotEmployers.delete(employerId);
            try {
              const r = await snapshotEmployer(employerId);
              if (r.persisted) { notifyScoreChangeIfCurrentPeriod(employerId, r.period, r.period).catch(() => {}); runMLOpsAssessment(employerId).catch((error: any) => console.error(`[sync] MLOps assessment failed for ${employerId}:`, error?.message ?? error)); }
            } catch (error: any) {
              console.error(`[sync] background snapshot failed for ${employerId}:`, error?.message ?? error);
            }
          }
        } finally {
          snapshotDrainScheduled = false;
        }
      })();
    });
  }

  const status = anyFailed ? (anyOk ? "PARTIAL" : "FAILED") : "OK";
  const mode = configuredSourceMode(config);
  const note = status === "OK"
    ? `All reports synced successfully from ${mode}; changed employer snapshots were queued in the background.`
    : status === "PARTIAL"
      ? `Some ${mode} reports synced. Failed report cursors were not advanced; see details.`
      : `${mode} sync failed; no report cursor was advanced for failed feeds.`;
  const finishedAt = new Date();

  await prisma.syncLog.update({
    where: { id: log.id },
    data: { status, finishedAt, summary: summary as Json, note },
  });
  await prisma.integrationConfig.update({
    where: { id: "default" },
    data: {
      lastSyncAt: finishedAt,
      ...(status === "OK" ? { lastSuccessfulSyncAt: finishedAt } : {}),
      lastSyncStatus: status,
      lastSyncNote: note,
    },
  });

  return { ok: status !== "FAILED", status, sourceMode: mode, note, throughAt, touchedEmployers: [...touchedEmployers], summary };
}

export async function testConnection(patch: IntegrationConfigPatch = {}) {
  const saved = await getConfig();
  const cleanPatch: IntegrationConfigPatch = { ...patch };
  if (cleanPatch.authToken === "" || cleanPatch.authToken == null) delete cleanPatch.authToken;
  if (cleanPatch.sqlPassword === "" || cleanPatch.sqlPassword == null) delete cleanPatch.sqlPassword;
  const config: any = { ...saved, ...cleanPatch };
  let adapter: Awaited<ReturnType<typeof createSourceAdapter>> | null = null;
  try {
    adapter = await createSourceAdapter(config);
    const result = await adapter.test();
    return { ...result, sourceMode: adapter.mode };
  } catch (error: any) {
    return { ok: false, error: error?.message ?? String(error), sourceMode: (() => { try { return configuredSourceMode(config); } catch { return "UNKNOWN"; } })() };
  } finally {
    if (adapter) {
      try { await adapter.close(); } catch {}
    }
  }
}

export async function recentSyncLogs(n = 10) {
  return prisma.syncLog.findMany({ orderBy: { startedAt: "desc" }, take: n });
}