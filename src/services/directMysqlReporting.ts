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
