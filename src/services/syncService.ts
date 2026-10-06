// ════════════════════════════════════════════════════════════════════
//  EXTERNAL SOURCE SYNC — API OR DIRECT SQL
//
//  Direct insert to target database, bypassing the broken sync chain.
//  Supports MySQL, PostgreSQL, and MSSQL as sources.
// ════════════════════════════════════════════════════════════════════

import { PrismaClient, Prisma } from "@prisma/client";
import { Client } from "pg";
import { LOAD_ORDER, getFormat } from "./reportFormats.js";
import { validate } from "./importParser.js";
import { snapshotEmployer } from "./snapshotBuilder.js";
import { notifyAdmins, notifyScoreChangeIfCurrentPeriod } from "./automationService.js";
import { commitBatch, commitSyncRows, SYNC_BULK_CHUNK_SIZE, type CommitProgress } from "./importService.js";
import { assessIncomingRows } from "./dataQualityService.js";
import { createSourceAdapter, configuredSourceMode, sourceIsConfigured } from "./sourceAdapter.js";
import { runMLOpsAssessment } from "./mlopsService.js";

const prisma = new PrismaClient();
type Json = Prisma.InputJsonValue;
const CURSOR_OVERLAP_MS = 5 * 60 * 1000;
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;
export const SOURCE_CHANGE_POLL_SECONDS = Math.max(15, Math.min(3600, Number(process.env.SOURCE_CHANGE_POLL_SECONDS ?? 30) || 30));
const pendingSnapshotEmployers = new Set<string>();
let snapshotDrainScheduled = false;

export interface SyncProgress {
  phase: "CONNECTING" | "READING_SOURCE" | "VALIDATING" | "COMMITTING" | "FEED_COMPLETE" | "REBUILDING_DASHBOARD" | "COMPLETE" | "FAILED";
  progress: number;
  message: string;
  reportKey?: string;
  feedIndex?: number;
  feedCount?: number;
  sourceTotalRows?: number | null;
  pulledRows?: number;
  validatedRows?: number;
  committedRows?: number;
  inserted?: number;
  updated?: number;
  deleted?: number;
  skipped?: number;
  historyRows?: number;
  batchId?: string;
}

interface RunSyncOptions {
  onProgress?: (progress: SyncProgress) => void | Promise<void>;
}

async function emitSyncProgress(options: RunSyncOptions, progress: SyncProgress) {
  if (options.onProgress) await options.onProgress(progress);
}

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
    changeDetectionSupported: effectiveSourceMode === "SQL",
    changeDetectionEnabled: configured && effectiveSourceMode === "SQL" && Boolean((config as any).enabled),
    sourceChangePollSeconds: SOURCE_CHANGE_POLL_SECONDS,
    syncBulkChunkSize: SYNC_BULK_CHUNK_SIZE,
    hasToken: Boolean(process.env.SOURCE_API_TOKEN || authToken),
    hasSqlPassword: Boolean(process.env.SOURCE_SQL_PASSWORD || sqlPassword),
    sqlPasswordFromEnvironment: Boolean(process.env.SOURCE_SQL_PASSWORD),
    apiTokenFromEnvironment: Boolean(process.env.SOURCE_API_TOKEN),
  };
}

function sourceWatermarkMillis(value: string | null | undefined): number | null {
  if (!value) return null;
  const raw = String(value).trim();
  // The integration contract defines source_updated_at as UTC. Some SQL
  // drivers return a timezone-less string, so normalise it to UTC before
  // comparing with the portal cursor.
  const hasZone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(raw);
  const normalized = hasZone ? raw : raw.replace(" ", "T") + "Z";
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

export async function detectSourceChanges() {
  const config = await getConfig();
  if (!config.enabled) return { supported: false, changed: false, reports: [], reason: "integration disabled" };
  let configured = false;
  try { configured = sourceIsConfigured(config); }
  catch (error: any) { return { supported: false, changed: false, reports: [], reason: error?.message ?? String(error) }; }
  if (!configured) return { supported: false, changed: false, reports: [], reason: "source not configured" };
  if (configuredSourceMode(config) !== "SQL") {
    return { supported: false, changed: false, reports: [], reason: "API sources use scheduled polling; SQL watermark detection is not available." };
  }

  let adapter: Awaited<ReturnType<typeof createSourceAdapter>> | null = null;
  try {
    adapter = await createSourceAdapter(config);
    if (!adapter.watermark) return { supported: false, changed: false, reports: [], reason: "source adapter does not expose watermarks" };
    const cursors = await prisma.integrationCursor.findMany({
      where: { reportKey: { in: LOAD_ORDER } },
      select: { reportKey: true, lastSourceUpdatedAt: true },
    });
    const byReport = new Map(cursors.map((cursor) => [cursor.reportKey, cursor.lastSourceUpdatedAt]));
    const reports: Array<{ reportKey: string; newest: string | null; cursor: string | null; location: string }> = [];

    for (const reportKey of LOAD_ORDER) {
      const watermark = await adapter.watermark(reportKey);
      const newestMs = sourceWatermarkMillis(watermark.newest);
      const cursor = byReport.get(reportKey) ?? null;
      const cursorMs = cursor?.getTime() ?? null;
      if (newestMs != null && (cursorMs == null || newestMs > cursorMs)) {
        reports.push({
          reportKey,
          newest: watermark.newest,
          cursor: cursor?.toISOString() ?? null,
          location: watermark.location,
        });
      }
    }
    return {
      supported: true,
      changed: reports.length > 0,
      reports,
      checkedAt: new Date().toISOString(),
      pollSeconds: SOURCE_CHANGE_POLL_SECONDS,
      strategy: "MAX(source_updated_at)",
    };
  } finally {
    if (adapter) {
      try { await adapter.close(); } catch {}
    }
  }
}

const FULL_REFRESH_LOCK_A = 0x454653; // must match dailyRefresh.ts
const SOURCE_SYNC_COORDINATION_LOCK_B = 79;
const SOURCE_INCREMENTAL_MUTEX_B = 80;

async function openIncrementalSyncLease() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required for source-sync coordination.");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    const result = await client.query(
      "SELECT pg_try_advisory_lock_shared($1, $2) AS acquired",
      [FULL_REFRESH_LOCK_A, SOURCE_SYNC_COORDINATION_LOCK_B],
    );
    if (!Boolean(result.rows?.[0]?.acquired)) {
      await client.end();
      return null;
    }
    const incremental = await client.query(
      "SELECT pg_try_advisory_lock($1, $2) AS acquired",
      [FULL_REFRESH_LOCK_A, SOURCE_INCREMENTAL_MUTEX_B],
    );
    if (!Boolean(incremental.rows?.[0]?.acquired)) {
      await client.query(
        "SELECT pg_advisory_unlock_shared($1, $2)",
        [FULL_REFRESH_LOCK_A, SOURCE_SYNC_COORDINATION_LOCK_B],
      ).catch(() => {});
      await client.end();
      return null;
    }
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    throw error;
  }
}

async function closeIncrementalSyncLease(client: Client | null) {
  if (!client) return;
  try {
    await client.query(
      "SELECT pg_advisory_unlock($1, $2)",
      [FULL_REFRESH_LOCK_A, SOURCE_INCREMENTAL_MUTEX_B],
    ).catch(() => {});
    await client.query(
      "SELECT pg_advisory_unlock_shared($1, $2)",
      [FULL_REFRESH_LOCK_A, SOURCE_SYNC_COORDINATION_LOCK_B],
    ).catch(() => {});
  } finally {
    await client.end().catch(() => {});
  }
}

export async function runSync(trigger: "manual" | "scheduled" | "full-refresh" = "manual", options: RunSyncOptions = {}) {
  // dailyRefresh.ts already owns the exclusive database lease while it calls
  // the full-refresh path. Every other sync takes a shared lease so an ordinary
  // sync can never overlap the purge/reload phase on another Railway replica.
  if (trigger === "full-refresh") return runSyncUnlocked(trigger, options);

  const lease = await openIncrementalSyncLease();
  if (!lease) {
    return {
      ok: false,
      status: "REBUILDING",
      error: "Another source sync or authoritative full refresh is already running. Try again after it completes.",
    };
  }
  try {
    return await runSyncUnlocked(trigger, options);
  } finally {
    await closeIncrementalSyncLease(lease);
  }
}

async function runSyncUnlocked(trigger: "manual" | "scheduled" | "full-refresh" = "manual", options: RunSyncOptions = {}) {
  const config = await getConfig();
  if (config.lastSyncStatus === "REBUILDING" && trigger !== "full-refresh") {
    return { ok: false, status: "REBUILDING", error: "A full source refresh is already rebuilding the dashboard. Try again after it completes." };
  }
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
  let failedStep: { reportIndex: number; reportKey: string; title: string; reason: string } | null = null;
  let adapter: Awaited<ReturnType<typeof createSourceAdapter>> | null = null;

  try {
    await emitSyncProgress(options, {
      phase: "CONNECTING",
      progress: 2,
      message: `Connecting to ${configuredSourceMode(config)} source`,
      feedCount: LOAD_ORDER.length,
    });
    adapter = await createSourceAdapter(config);

    for (let reportIndex = 0; reportIndex < LOAD_ORDER.length; reportIndex++) {
      const reportKey = LOAD_ORDER[reportIndex];
      const format = getFormat(reportKey);
      if (!format) continue;

      const cursor = await prisma.integrationCursor.upsert({
        where: { reportKey },
        create: { reportKey, lastAttemptAt: new Date(), lastStatus: "RUNNING" },
        update: { lastAttemptAt: new Date(), lastStatus: "RUNNING", lastNote: null },
      });

      try {
        const isFirstSync = cursor.lastSourceUpdatedAt === null && cursor.lastSuccessAt === null;
        const authoritativeOverwrite = trigger === "full-refresh";
        const requestSince = authoritativeOverwrite ? null : (isFirstSync ? null : overlapCursor(cursor.lastSourceUpdatedAt));
        if (isFirstSync) {
          console.log(`[sync] ${reportKey}: first sync detected, loading all records without date filtering.`);
        }
        const route = await prisma.analyticsRoute.findUnique({ where: { reportKey } });
        const useSourceRoute = route?.enabled && (route.executionMode === "SOURCE" || route.executionMode === "HYBRID") && route.sourceView;
        if (useSourceRoute && configuredSourceMode(config) !== "SQL") {
          throw new Error(`Analytics route for ${reportKey} requires SQL source mode.`);
        }
        let sourceTotalRows: number | null = null;
        if (options.onProgress && adapter.mode === "SQL" && adapter.describe) {
          try {
            const described = await adapter.describe(reportKey);
            sourceTotalRows = Number.isFinite(Number(described.totalRows)) ? Number(described.totalRows) : null;
          } catch {}
        }
        const feedSpan = 82 / Math.max(1, LOAD_ORDER.length);
        const feedStart = 5 + reportIndex * feedSpan;
        await emitSyncProgress(options, {
          phase: "READING_SOURCE",
          progress: Math.round(feedStart),
          message: sourceTotalRows == null
            ? `Reading ${reportKey} from ${adapter.mode}`
            : `Reading ${reportKey}: source view contains ${sourceTotalRows.toLocaleString("en-ZA")} row(s)`,
          reportKey,
          feedIndex: reportIndex + 1,
          feedCount: LOAD_ORDER.length,
          sourceTotalRows,
          committedRows: 0,
        });

        const pulled = await adapter.fetchReport(reportKey, {
          since: requestSince,
          through: throughAt,
        }, useSourceRoute ? route.sourceView : null, {
          useReplica: Boolean(useSourceRoute && (route.useReplica || config.sourceAnalyticsUseReplica)),
        });
        await emitSyncProgress(options, {
          phase: "VALIDATING",
          progress: Math.round(feedStart + 2),
          message: `Validating ${pulled.records.length.toLocaleString("en-ZA")} ${reportKey} row(s)`,
          reportKey,
          feedIndex: reportIndex + 1,
          feedCount: LOAD_ORDER.length,
          sourceTotalRows,
          pulledRows: pulled.records.length,
          committedRows: 0,
        });
        const result = validate(format, pulled.records);

        const skewCeiling = new Date(throughAt.getTime() + CLOCK_SKEW_TOLERANCE_MS);
        const genuinelyFutureRows = result.rows.filter((row: any) => row.source_updated_at > skewCeiling);
        if (genuinelyFutureRows.length && !authoritativeOverwrite) {
          throw new Error(`${reportKey}: ${genuinelyFutureRows.length} record(s) had source_updated_at more than ${CLOCK_SKEW_TOLERANCE_MS / 60000} minute(s) later than the requested through timestamp — check the source database's clock/timezone settings.`);
        }
        result.rows = result.rows.map((row: any) =>
          row.source_updated_at > throughAt ? { ...row, source_updated_at: throughAt } : row
        );
        const newestPulledAt = result.rows.reduce<Date | null>((latest: Date | null, row: any) => {
          const value = row.source_updated_at instanceof Date ? row.source_updated_at : new Date(row.source_updated_at);
          if (!Number.isFinite(value.getTime())) return latest;
          return !latest || value > latest ? value : latest;
        }, null);

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
          failedStep = { reportIndex, reportKey, title: format.title, reason: note };
          console.error(`[sync] STEP ${reportIndex + 1} ${format.title} failed validation: ${note}`);
          break;
        }

        if (result.rowCount === 0) {
          if (isFirstSync && trigger !== "full-refresh") {
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
            failedStep = { reportIndex, reportKey, title: format.title, reason: note };
            console.error(`[sync] STEP ${reportIndex + 1} ${format.title} failed: ${note}`);
            break;
          }
          let rebasedCursor = cursor.lastSourceUpdatedAt;
          if (adapter.mode === "SQL" && adapter.watermark && cursor.lastSourceUpdatedAt) {
            try {
              const watermark = await adapter.watermark(reportKey);
              const newestMs = sourceWatermarkMillis(watermark.newest);
              if (newestMs != null && newestMs < cursor.lastSourceUpdatedAt.getTime()) {
                rebasedCursor = new Date(newestMs);
              }
            } catch {}
          }
          await prisma.integrationCursor.update({
            where: { reportKey },
            data: {
              lastSuccessAt: new Date(),
              ...(rebasedCursor && rebasedCursor.getTime() !== cursor.lastSourceUpdatedAt?.getTime()
                ? { lastSourceUpdatedAt: rebasedCursor }
                : {}),
              lastStatus: "OK",
              lastNote: rebasedCursor && rebasedCursor.getTime() !== cursor.lastSourceUpdatedAt?.getTime()
                ? `No changed records via ${adapter.mode}; corrected the legacy cursor to the source watermark ${rebasedCursor.toISOString()}.`
                : (trigger === "full-refresh" ? `Authoritative full refresh confirmed 0 source rows via ${adapter.mode}.` : `No changed records in the requested window via ${adapter.mode}.`),
            },
          });
          summary[reportKey] = { source: pulled.location, pulled: 0, committed: 0, since: requestSince, through: throughAt, sourceWatermark: rebasedCursor };
          anyOk = true;
          continue;
        }

        // Incremental syncs use the MLOps safety gate. An authoritative
        // purge+overwrite deliberately does not: after Reset/Refresh the connected
        // source is the truth and every structurally valid row must be rewritten.
        const quality = authoritativeOverwrite
          ? { status: "PASS" as const, findings: [] as any[], bypassed: true }
          : await assessIncomingRows({ reportKey, rows: result.rows as Record<string, unknown>[] });
        if (!authoritativeOverwrite && quality.status === "QUARANTINE") {
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
          const failureReason = `MLOps data-quality gate blocked the sync: ${reason}`;
          summary[reportKey] = { error: failureReason, source: pulled.location, pulled: result.rowCount, committed: 0, batchId: blockedBatch.id };
          anyFailed = true;
          failedStep = { reportIndex, reportKey, title: format.title, reason: failureReason };
          console.error(`[sync] STEP ${reportIndex + 1} ${format.title} blocked by MLOps: ${reason}`);
          break;
        }

        if (!authoritativeOverwrite && quality.status === "REVIEW") {
          const warning = quality.findings.filter((f) => f.severity === "WARNING").slice(0, 5)
            .map((f) => `${f.code}${f.field ? `(${f.field})` : ""}: ${f.message}`).join(" | ");
          console.warn(`[mlops] ${reportKey} allowed with REVIEW warnings: ${warning}`);
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
        const reportProgress = async (p: CommitProgress) => {
          await prisma.importBatch.update({
            where: { id: batch.id },
            data: {
              insertedCount: p.inserted,
              updatedCount: p.updated,
              deletedCount: p.deleted,
            },
          });
          const fraction = p.total > 0 ? p.processed / p.total : 1;
          await emitSyncProgress(options, {
            phase: "COMMITTING",
            progress: Math.min(92, Math.round(feedStart + 2 + fraction * Math.max(0.5, feedSpan - 2))),
            message: `${reportKey}: ${p.processed.toLocaleString("en-ZA")} / ${p.total.toLocaleString("en-ZA")} rows processed into live tables`,
            reportKey,
            feedIndex: reportIndex + 1,
            feedCount: LOAD_ORDER.length,
            sourceTotalRows,
            pulledRows: pulled.records.length,
            validatedRows: result.rowCount,
            committedRows: p.processed,
            inserted: p.inserted,
            updated: p.updated,
            deleted: p.deleted,
            skipped: p.skipped,
            historyRows: p.historyRows,
            batchId: batch.id,
          });
        };
        await emitSyncProgress(options, {
          phase: "COMMITTING",
          progress: Math.round(feedStart + 2),
          message: `${reportKey}: 0 / ${result.rowCount.toLocaleString("en-ZA")} rows processed into live tables`,
          reportKey,
          feedIndex: reportIndex + 1,
          feedCount: LOAD_ORDER.length,
          sourceTotalRows,
          pulledRows: pulled.records.length,
          validatedRows: result.rowCount,
          committedRows: 0,
          inserted: 0,
          updated: 0,
          deleted: 0,
          skipped: 0,
          batchId: batch.id,
        });
        let usedCompatibilityFallback = false;
        try {
          committed = await commitSyncRows(reportKey, result.rows as Record<string, any>[], reportProgress, { authoritativeOverwrite });
        } catch (error: any) {
          // Correctness-first compatibility path. Missing procedures are a deploy
          // problem; SQLSTATE 21000 means a set-based projection encountered more
          // than one source observation for the same current-state key. In either
          // case, preserve the old proven importer instead of breaking Sync now /
          // Refresh now. The fallback is slower but keeps the feed operational.
          const message = error?.message ?? String(error);
          const code = String(error?.code ?? error?.meta?.code ?? "");
          const missingProcedure = /function sync_upsert_.* does not exist/i.test(message);
          const cardinalityConflict = code === "21000"
            || /ON CONFLICT DO UPDATE command cannot affect row a second time/i.test(message);
          if (!missingProcedure && !cardinalityConflict) throw error;
          usedCompatibilityFallback = true;
          console.warn(
            `[sync] ${reportKey} bulk path unavailable (${code || "compat"}); using proven chunked importer for this feed.`,
          );
          await prisma.importBatch.update({ where: { id: batch.id }, data: { stagedRows: result.rows as Json } });
          committed = await commitBatch(batch.id, { recompute: false, onProgress: reportProgress });
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
          historyRows: committed.historyRows ?? 0,
          importMode: usedCompatibilityFallback ? "CHUNKED_COMPATIBILITY" : "BULK_SQL",
          authoritativeOverwrite,
          mlops: authoritativeOverwrite ? "BYPASSED_AUTHORITATIVE_OVERWRITE" : quality.status,
          since: requestSince,
          through: throughAt,
        };
        await emitSyncProgress(options, {
          phase: "FEED_COMPLETE",
          progress: Math.min(92, Math.round(5 + ((reportIndex + 1) / Math.max(1, LOAD_ORDER.length)) * 82)),
          message: `${reportKey} complete: ${result.rowCount.toLocaleString("en-ZA")} rows processed`,
          reportKey,
          feedIndex: reportIndex + 1,
          feedCount: LOAD_ORDER.length,
          sourceTotalRows,
          pulledRows: pulled.records.length,
          validatedRows: result.rowCount,
          committedRows: result.rowCount,
          inserted: committed.inserted,
          updated: committed.updated,
          deleted: committed.deleted,
          skipped: committed.skipped,
          historyRows: committed.historyRows,
          batchId: batch.id,
        });

        const previousCursor = cursor.lastSourceUpdatedAt;
        await prisma.integrationCursor.update({
          where: { reportKey },
          data: {
            lastSuccessAt: new Date(),
            lastSourceUpdatedAt: newestPulledAt ?? cursor.lastSourceUpdatedAt ?? throughAt,
            lastStatus: "OK",
            lastNote: authoritativeOverwrite
              ? `Authoritative overwrite accepted ${result.rowCount} source row(s) via ${adapter.mode}${usedCompatibilityFallback ? " (chunked compatibility fallback)" : " bulk SQL"}; prior cursors/MLOps/staleness were ignored.`
              : `${committed.inserted} inserted, ${committed.updated} updated, ${committed.deleted} deleted, ${committed.skipped} stale skipped via ${adapter.mode}${usedCompatibilityFallback ? " (chunked compatibility fallback)" : " bulk SQL"}.`,
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
        failedStep = { reportIndex, reportKey, title: format.title, reason: note };
        console.error(`[sync] STEP ${reportIndex + 1} ${format.title} failed: ${note}`);
        break;
      }
    }

    // The feed sequence is a dependency chain, not ten independent imports.
    // Once a step fails, later steps must not run against an incomplete parent
    // state. Mark them BLOCKED without advancing their source cursors.
    if (failedStep) {
      for (let blockedIndex = failedStep.reportIndex + 1; blockedIndex < LOAD_ORDER.length; blockedIndex++) {
        const blockedKey = LOAD_ORDER[blockedIndex];
        const blockedFormat = getFormat(blockedKey);
        const blockedTitle = blockedFormat?.title ?? blockedKey;
        const blockedNote = `Blocked by STEP ${failedStep.reportIndex + 1} ${failedStep.title}: ${failedStep.reason}`;
        summary[blockedKey] = {
          status: "BLOCKED",
          committed: 0,
          blockedBy: failedStep.reportKey,
          blockedByStep: failedStep.reportIndex + 1,
          note: blockedNote,
        };
        await prisma.integrationCursor.upsert({
          where: { reportKey: blockedKey },
          create: { reportKey: blockedKey, lastStatus: "BLOCKED", lastNote: blockedNote },
          update: { lastStatus: "BLOCKED", lastNote: blockedNote },
        });
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

  // A full refresh is not complete until the read model has been rebuilt.
  // Normal incremental syncs keep snapshot work off the critical path.
  if (trigger === "full-refresh" && !anyFailed) {
    for (const employerId of touchedEmployers) {
      try {
        const r = await snapshotEmployer(employerId);
        if (r.persisted) {
          notifyScoreChangeIfCurrentPeriod(employerId, r.period, r.period).catch(() => {});
          runMLOpsAssessment(employerId).catch((error: any) => console.error(`[sync] MLOps assessment failed for ${employerId}:`, error?.message ?? error));
        }
      } catch (error: any) {
        anyFailed = true;
        summary.snapshots ??= {};
        summary.snapshots[employerId] = { error: error?.message ?? String(error) };
        console.error(`[sync] full-refresh snapshot failed for ${employerId}:`, error?.message ?? error);
      }
    }
  } else if (!anyFailed) {
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
  }

  if (!anyFailed) {
    await emitSyncProgress(options, {
      phase: "REBUILDING_DASHBOARD",
      progress: 96,
      message: trigger === "full-refresh"
        ? "Source rows are committed; rebuilding dashboard snapshots before publish"
        : "Source rows are committed; finalising dashboard refresh",
      feedCount: LOAD_ORDER.length,
    });
  }
  const status = anyFailed ? (anyOk ? "PARTIAL" : "FAILED") : "OK";
  const mode = configuredSourceMode(config);
  const failedDetail = failedStep
    ? `STEP ${failedStep.reportIndex + 1} ${failedStep.title} failed: ${failedStep.reason}`
    : null;
  const blockedCount = failedStep ? Math.max(0, LOAD_ORDER.length - failedStep.reportIndex - 1) : 0;
  const note = status === "OK"
    ? trigger === "full-refresh"
      ? `All 10 reports synced successfully from ${mode} in dependency order; dashboard snapshots were rebuilt before completion.`
      : `All 10 reports synced successfully from ${mode} in dependency order; changed employer snapshots were queued in the background.`
    : failedDetail
      ? `${failedDetail} ${blockedCount} downstream step${blockedCount === 1 ? "" : "s"} blocked to preserve load order. Last successful dashboard remains in place; failed and blocked cursors were not advanced.`
      : `${mode} sync failed before the ordered feed chain completed. Last successful dashboard remains in place.`;
  const finishedAt = new Date();

  await prisma.syncLog.update({
    where: { id: log.id },
    data: { status, finishedAt, summary: summary as Json, note },
  });
  // The authoritative full-refresh wrapper owns publication state. Keep the
  // portal in REBUILDING until it has captured a complete published dashboard;
  // otherwise this lower-level sync would briefly expose in-progress raw data.
  if (trigger !== "full-refresh") {
    await prisma.integrationConfig.update({
      where: { id: "default" },
      data: {
        lastSyncAt: finishedAt,
        ...(status === "OK" ? { lastSuccessfulSyncAt: finishedAt } : {}),
        lastSyncStatus: status,
        lastSyncNote: note,
      },
    });
  }

  await emitSyncProgress(options, {
    phase: status === "OK" ? "COMPLETE" : "FAILED",
    progress: 100,
    message: note,
    feedCount: LOAD_ORDER.length,
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