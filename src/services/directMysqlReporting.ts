/**
 * Explicit, read-only MySQL reporting path. No Prisma model, staging batch,
 * import cursor or PostgreSQL projection is written by this service.
 *
 * This is the first opt-in query path, not a replacement for the full
 * historical snapshot/score engine in snapshotBuilder.ts.
 */
import type { IntegrationSourceConfig } from "./sourceAdapter.js";
import { effectiveSourceConfig } from "./sourceAdapter.js";
import { getFormat, LOAD_ORDER } from "./reportFormats.js";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_QUERY_MS = 10_000;

export interface DirectReportingRequest {
  reportKey: string;
  employerRef?: string;
}
export interface DirectReportingSummary {
  reportKey: string;
  source: "MYSQL";
  view: string;
  employerRef: string | null;
  recordCount: string;
  latestSourceUpdate: string | null;
  queriedAt: string;
  replicatedToPostgres: false;
}

function safeIdentifier(raw: string, description: string): string {
  if (!IDENTIFIER.test(raw)) throw new Error(`Invalid ${description}`);
  return "`" + raw + "`";
}

export function directReportingEnabled(): boolean {
  return process.env.DIRECT_MYSQL_REPORTING_ENABLED === "true";
}

/**
 * An explicit feature gate, an allowlisted canonical feed, and a fixed
 * parameterized aggregate. NEVER accept SQL, columns or view names from HTTP.
 * The database login must be GRANT SELECT only on approved views.
 */
export async function readMysqlReportSummary(
  config: IntegrationSourceConfig,
  request: DirectReportingRequest,
): Promise<DirectReportingSummary> {
  if (!directReportingEnabled()) throw new Error("Direct MySQL reporting is disabled");
  const reportKey = String(request.reportKey ?? "").trim();
  if (!LOAD_ORDER.includes(reportKey as typeof LOAD_ORDER[number]) || !getFormat(reportKey)) {
    throw new Error("Unknown reporting feed");
  }
  const employerRef = request.employerRef == null ? null : String(request.employerRef).trim();
  if (employerRef !== null && (!employerRef || employerRef.length > 128)) {
    throw new Error("Invalid employer reference");
  }
  const source = effectiveSourceConfig(config);
  if (String(source.sourceMode ?? "").toUpperCase() !== "SQL" ||
      String(source.sqlDialect ?? "").toUpperCase() !== "MYSQL") {
    throw new Error("A MySQL SQL source must be configured");
  }
  if (source.sqlSsl !== true || source.sqlTrustServerCertificate === true) {
    throw new Error("MySQL reporting requires verified TLS");
  }
  if (!source.sqlHost || !source.sqlDatabase || !source.sqlUsername || !source.sqlPassword) {
    throw new Error("MySQL reporting credentials are incomplete");
  }
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(source.sqlHost)) throw new Error("Invalid MySQL host");
  const database = safeIdentifier(source.sqlDatabase, "database");
  const prefix = source.sqlViewPrefix ?? "v_";
  const view = prefix + reportKey;
  const table = database + "." + safeIdentifier(view, "reporting view");
  const port = Number(source.sqlPort ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid MySQL port");
  const mysql = await import("mysql2/promise");
  const client = await mysql.createConnection({
    host: source.sqlHost, port, database: source.sqlDatabase,
    user: source.sqlUsername, password: source.sqlPassword,
    ssl: { rejectUnauthorized: true },
    connectTimeout: MAX_QUERY_MS,
    timezone: "Z",
    supportBigNumbers: true,
    bigNumberStrings: true,
    multipleStatements: false,
  });
  try {
    // This is defence in depth; privileges MUST also be SELECT-only.
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("START TRANSACTION");
    const statement =
      `SELECT COUNT(*) AS recordCount, MAX(source_updated_at) AS latestSourceUpdate FROM ${table}` +
      (employerRef !== null ? " WHERE employer_ref = ?" : "");
    const [rows] = await client.query({ sql: statement, timeout: MAX_QUERY_MS }, employerRef === null ? [] : [employerRef]);
    const item = (rows as Record<string, unknown>[])[0];
    if (!item) throw new Error("MySQL reporting view returned no aggregate");
    const newest = item.latestSourceUpdate;
    return {
      reportKey, source: "MYSQL", view,
      employerRef,
      recordCount: String(item.recordCount ?? "0"),
      latestSourceUpdate: newest instanceof Date ? newest.toISOString() : newest == null ? null : String(newest),
      queriedAt: new Date().toISOString(),
      replicatedToPostgres: false,
    };
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
}

/**
 * A source-side activity KPI: journeys started inside a half-open UTC date
 * window. This intentionally does not claim to reproduce the full dashboard
 * score, which needs a separate parity-tested historical model.
 */
export interface DirectJourneyKpiRequest {
  employerRef: string;
  startDate: string; // inclusive YYYY-MM-DD
  endDate: string;   // exclusive YYYY-MM-DD
}
export interface DirectJourneyKpis {
  source: "MYSQL";
  employerRef: string;
  startDate: string;
  endDate: string;
  startedJourneys: string;
  completedOfStartedJourneys: string;
  monthlySavingsOfCompletedStartedJourneysRand: string;
  replicatedToPostgres: false;
}
function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export async function readMysqlJourneyKpis(
  config: IntegrationSourceConfig,
  request: DirectJourneyKpiRequest,
): Promise<DirectJourneyKpis> {
  if (!directReportingEnabled()) throw new Error("Direct MySQL reporting is disabled");
  const employerRef = String(request.employerRef ?? "").trim();
  if (!employerRef || employerRef.length > 128) throw new Error("Employer scope is required");
  const { startDate, endDate } = request;
  if (!validDate(startDate) || !validDate(endDate) || startDate >= endDate) {
    throw new Error("Invalid report date interval");
  }
  // Hard maximum history window to bound load on the source database.
  if ((Date.parse(endDate) - Date.parse(startDate)) > 366 * 86_400_000) {
    throw new Error("Reporting interval exceeds one year");
  }
  const source = effectiveSourceConfig(config);
  if (String(source.sourceMode ?? "").toUpperCase() !== "SQL" ||
      String(source.sqlDialect ?? "").toUpperCase() !== "MYSQL" ||
      source.sqlSsl !== true || source.sqlTrustServerCertificate === true) {
    throw new Error("A verified-TLS MySQL source is required");
  }
  if (!source.sqlHost || !source.sqlDatabase || !source.sqlUsername || !source.sqlPassword ||
      !/^[A-Za-z0-9.-]{1,253}$/.test(source.sqlHost)) {
    throw new Error("Missing or invalid MySQL connection configuration");
  }
  const port = Number(source.sqlPort ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid MySQL port");
  const view = safeIdentifier(source.sqlDatabase, "database") + "." +
    safeIdentifier((source.sqlViewPrefix ?? "v_") + "journeys", "reporting view");
  const mysql = await import("mysql2/promise");
  const client = await mysql.createConnection({
    host: source.sqlHost, port, database: source.sqlDatabase,
    user: source.sqlUsername, password: source.sqlPassword,
    ssl: { rejectUnauthorized: true }, connectTimeout: MAX_QUERY_MS,
    timezone: "Z", supportBigNumbers: true, bigNumberStrings: true,
    multipleStatements: false,
  });
  try {
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("START TRANSACTION");
    const [rows] = await client.query({
      sql: `SELECT COUNT(*) AS startedJourneys,
        COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END),0) AS completedOfStartedJourneys,
        COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN monthly_saving_rand ELSE 0 END),0) AS savingsRand
        FROM ${view}
        WHERE employer_ref = ? AND started_at >= ? AND started_at < ?`,
      timeout: MAX_QUERY_MS,
    }, [employerRef, startDate, endDate]);
    const item = (rows as Record<string, unknown>[])[0];
    if (!item) throw new Error("Source returned no journey aggregate");
    return {
      source: "MYSQL", employerRef, startDate, endDate,
      startedJourneys: String(item.startedJourneys ?? "0"),
      completedOfStartedJourneys: String(item.completedOfStartedJourneys ?? "0"),
      monthlySavingsOfCompletedStartedJourneysRand: String(item.savingsRand ?? "0"),
      replicatedToPostgres: false,
    };
  } finally {
    try { await client.query("ROLLBACK"); } finally { await client.end(); }
  }
}
