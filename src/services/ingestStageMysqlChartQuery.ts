/**
 * MySQL-native chart datasets; never hydrate source rows in the app store.
 * Default-off until independently approved tenant/source mapping is live.
 */
import { LOAD_ORDER } from "./reportFormats.js";
import {
  type CdcMysqlReaderSettings, type VerifiedEmployerScope, type CdcMysqlConnector,
  validateSettings, validateRequest, connectReadOnly, columnNames,
} from "./ingestStageCdcMysqlReader.js";

export const CHART_DIMENSIONS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  employers: ["name"],
  workforce_snapshots: ["as_of_date"],
  employees: ["site_name", "income_band", "active"],
  platform_users: ["has_credit_profile"],
  journeys: ["status", "type"],
  debt_accounts: ["credit_type", "in_arrears", "state"],
  policies: ["type", "is_wasteful", "is_resolved"],
  ratings: ["stars", "journey_type"],
  referrals: ["channel", "converted"],
  salary_advances: ["salary_advance_status", "bank_account_verification_status"],
});
const FEEDS = new Set(LOAD_ORDER);
const IDENT = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_GROUPS = 50;
function quote(identifier: string): string {
  if (!IDENT.test(identifier)) throw new Error("CDC_METRIC_IDENTIFIER_INVALID");
  return "`" + identifier + "`";
}

/**
 * One fixed-allowlist GROUP BY, performed in MySQL.
 * No ORDER BY on source row values; only on tiny aggregated groups.
 * Missing view columns fail closed before a SELECT against source data.
 */
export function buildMysqlChartQuery(
  feed: string, dimension: string, employerRef: string,
  viewColumns: ReadonlySet<string>, limit = 20,
) {
  if (!FEEDS.has(feed) || !CHART_DIMENSIONS[feed]?.includes(dimension))
    throw new Error("CDC_METRIC_NOT_ALLOWLISTED");
  if (typeof employerRef !== "string" || !employerRef.trim() ||
      employerRef.length > 200 || employerRef !== employerRef.trim())
    throw new Error("CDC_METRIC_EMPLOYER_INVALID");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_GROUPS)
    throw new Error("CDC_METRIC_GROUP_LIMIT_INVALID");
  if (!viewColumns.has("employer_ref") || !viewColumns.has(dimension))
    throw new Error("CDC_METRIC_VIEW_CONTRACT_INCOMPLETE");
  const view = quote("ingest_stage") + "." + quote("v_" + feed);
  const col = quote(dimension);
  return {
    sql: "SELECT " + col + " AS bucket, COUNT(*) AS value FROM " + view +
      " WHERE `employer_ref` = ? GROUP BY " + col +
      " ORDER BY value DESC, bucket ASC LIMIT ?",
    params: [employerRef, limit + 1] as unknown[],
  };
}

export interface MysqlChartResult {
  source: "MYSQL_AGGREGATED_READ_ONLY";
  sourceId: string;
  tenantId: string;
  employerRef: string;
  feed: string;
  dimension: string;
  buckets: Array<{ bucket: string | number | boolean | null; value: number }>;
}

export async function readMysqlChart(
  feed: string, dimension: string, employerRef: string,
  scope: VerifiedEmployerScope, settings: CdcMysqlReaderSettings,
  connect: CdcMysqlConnector = connectReadOnly,
  limit = 20,
): Promise<MysqlChartResult> {
  validateSettings(settings);
  validateRequest(feed, employerRef, scope, settings);
  // Reject bad metric choices before any driver/network operation.
  if (!FEEDS.has(feed) || !CHART_DIMENSIONS[feed]?.includes(dimension) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_GROUPS)
    throw new Error("CDC_METRIC_NOT_ALLOWLISTED_OR_BUDGET_INVALID");
  let db: Awaited<ReturnType<CdcMysqlConnector>> | null = null;
  let transaction = false;
  try {
    db = await connect(settings);
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await db.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    transaction = true;
    const [metadata] = await db.query({
      sql: "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=?",
      timeout: settings.queryTimeoutMs,
    }, ["ingest_stage", "v_" + feed]);
    const planned = buildMysqlChartQuery(feed, dimension, employerRef, columnNames(metadata), limit);
    const [results] = await db.query({ sql: planned.sql, timeout: settings.queryTimeoutMs }, planned.params);
    if (!Array.isArray(results) || results.length > limit)
      throw new Error("CDC_METRIC_TOO_MANY_GROUPS");
    const buckets = results.map(row => {
      if (!row || typeof row !== "object" || !("bucket" in row) || !("value" in row))
        throw new Error("CDC_METRIC_RESULT_INVALID");
      const r = row as Record<string, unknown>;
      const bucket = r.bucket;
      const value = r.value;
      if (!(bucket === null || typeof bucket === "string" ||
            typeof bucket === "boolean" || (typeof bucket === "number" && Number.isFinite(bucket))) ||
          (typeof bucket === "string" && bucket.length > 256) ||
          (typeof value !== "number" && typeof value !== "string") ||
          !Number.isSafeInteger(Number(value)) || Number(value) < 0)
        throw new Error("CDC_METRIC_RESULT_INVALID");
      return { bucket, value: Number(value) } as MysqlChartResult["buckets"][number];
    });
    await db.query("ROLLBACK");
    transaction = false;
    await db.end();
    db = null;
    return {source:"MYSQL_AGGREGATED_READ_ONLY",sourceId:scope.sourceId,
      tenantId:scope.tenantId,employerRef,feed,dimension,buckets};
  } catch {
    throw new Error("CDC_METRIC_MYSQL_READ_FAILED");
  } finally {
    if (db) {
      if (transaction) { try { await db.query("ROLLBACK"); } catch { /* fail closed */ } }
      try { await db.end(); } catch { /* no sensitive driver errors */ }
    }
  }
}
