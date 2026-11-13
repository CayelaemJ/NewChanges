/**
 * The Fixer / ingest_stage -- bounded, read-only canonical MySQL view reader.
 *
 * NOT wired to existing app routes or the Postgres-backed syncService.
 * Production use is blocked unless an independent caller supplies an
 * authenticated employer scope and explicit approval gates.
 * This service does not write RDS rows, checkpoint state or Postgres records.
 */
import { readFile } from "node:fs/promises";
import { LOAD_ORDER, getFormat } from "./reportFormats.js";

type SourceRow = Record<string, unknown>;
type MySqlRows = unknown;
export interface CdcMysqlQueryOptions { sql: string; timeout: number }
export interface CdcMysqlQueryConnection {
  query(sql: string | CdcMysqlQueryOptions, params?: unknown[]): Promise<[MySqlRows, unknown]>;
  end(): Promise<void>;
}
export interface CdcMysqlReaderSettings {
  featureEnabled: boolean;
  accessReviewed: boolean;
  snapshotVerified: boolean;
  hostname: string;
  port: number;
  username: string;
  password: string;
  caCertificatePath: string;
  queryTimeoutMs: number;
  maxRows: number;
}
export interface VerifiedEmployerScope {
  // Must be built from server-side authentication/tenant authorization,
  // never directly from request query parameters or browser-provided claims.
  authorizedEmployerRefs: readonly string[];
}
export interface CdcMysqlFeedRead {
  feed: string;
  employerRef: string;
  records: SourceRow[];
  complete: true;
  source: "MYSQL_READ_ONLY";
}
export type CdcMysqlConnector =
  (settings: CdcMysqlReaderSettings) => Promise<CdcMysqlQueryConnection>;

const ALLOWED = new Set<string>(LOAD_ORDER);
const IDENTIFIER = /^[a-z][a-z0-9_]{0,63}$/;
const RDS_HOST = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.rds\.amazonaws\.com$/;
const QUOTE = String.fromCharCode(96);

function quoteIdentifier(value: string): string {
  if (!IDENTIFIER.test(value)) throw new Error("Invalid canonical SQL identifier");
  return QUOTE + value + QUOTE;
}

function safeEmployerRef(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= 200 && value === value.trim();
}

function validateSettings(settings: CdcMysqlReaderSettings): void {
  if (settings.featureEnabled !== true ||
      settings.accessReviewed !== true ||
      settings.snapshotVerified !== true)
    throw new Error("CDC_MYSQL_READ_GATE_CLOSED");
  if (!RDS_HOST.test(settings.hostname) ||
      !Number.isInteger(settings.port) ||
      settings.port < 1 || settings.port > 65535)
    throw new Error("CDC_MYSQL_ENDPOINT_NOT_APPROVED");
  // Never connect using the recovered RDS master credentials.
  if (!IDENTIFIER.test(settings.username) ||
      ["root", "fixeradmin", "rdsadmin", "admin"].includes(settings.username.toLowerCase()) ||
      !settings.username.toLowerCase().includes("read"))
    throw new Error("CDC_MYSQL_DEDICATED_READER_REQUIRED");
  if (!settings.password || !settings.caCertificatePath)
    throw new Error("CDC_MYSQL_TLS_CREDENTIALS_REQUIRED");
  if (!Number.isInteger(settings.queryTimeoutMs) ||
      settings.queryTimeoutMs < 1000 || settings.queryTimeoutMs > 30000)
    throw new Error("CDC_MYSQL_QUERY_TIMEOUT_INVALID");
  if (!Number.isInteger(settings.maxRows) ||
      settings.maxRows < 1 || settings.maxRows > 2000)
    throw new Error("CDC_MYSQL_REPORT_BUDGET_INVALID");
}

function validateRequest(feed: string, employerRef: string, scope: VerifiedEmployerScope): void {
  if (!ALLOWED.has(feed) || !getFormat(feed))
    throw new Error("CDC_MYSQL_FEED_NOT_ALLOWLISTED");
  if (!safeEmployerRef(employerRef) ||
      !Array.isArray(scope?.authorizedEmployerRefs) ||
      scope.authorizedEmployerRefs.length === 0 ||
      scope.authorizedEmployerRefs.length > 128 ||
      !scope.authorizedEmployerRefs.every(safeEmployerRef) ||
      !scope.authorizedEmployerRefs.includes(employerRef))
    throw new Error("CDC_MYSQL_EMPLOYER_SCOPE_DENIED");
}

async function connectReadOnly(settings: CdcMysqlReaderSettings): Promise<CdcMysqlQueryConnection> {
  // No driver connection is created until all gates and tenant scope pass.
  const ca = await readFile(settings.caCertificatePath, "utf8");
  if (!ca.includes("BEGIN CERTIFICATE")) throw new Error("CDC_MYSQL_CA_INVALID");
  const mysql = await import("mysql2/promise");
  const connection = await mysql.createConnection({
    host: settings.hostname,
    port: settings.port,
    user: settings.username,
    password: settings.password,
    database: "ingest_stage",
    connectTimeout: Math.min(settings.queryTimeoutMs, 10000),
    multipleStatements: false,
    timezone: "Z",
    ssl: {
      ca,
      rejectUnauthorized: true,
      // mysql2 disables hostname checks by default for compatibility:
      // verifyIdentity must be explicitly true to validate the RDS hostname.
      verifyIdentity: true,
    },
  });
  return connection as unknown as CdcMysqlQueryConnection;
}

function columnNames(rows: unknown): Set<string> {
  if (!Array.isArray(rows) ||
      rows.some(row => !row || typeof row !== "object" ||
        typeof row.COLUMN_NAME !== "string"))
    throw new Error("CDC_MYSQL_METADATA_INVALID");
  return new Set(rows.map(row => row.COLUMN_NAME as string));
}

export function buildCdcMysqlViewQuery(
  feed: string, employerRef: string, viewColumns: ReadonlySet<string>, maxRows: number,
): { sql: string; params: unknown[]; projection: string[] } {
  const format = getFormat(feed);
  if (!ALLOWED.has(feed) || !format)
    throw new Error("CDC_MYSQL_FEED_NOT_ALLOWLISTED");
  if (!safeEmployerRef(employerRef) || !Number.isInteger(maxRows) ||
      maxRows < 1 || maxRows > 2000)
    throw new Error("CDC_MYSQL_REPORT_BUDGET_INVALID");
  // Only known, declared source fields may leave this query service.
  const projection = format.fields.map(field => field.name)
    .filter(name => viewColumns.has(name));
  const required = new Set([
    "employer_ref", ...format.naturalKey,
    ...format.fields.filter(field => field.required).map(field => field.name),
  ]);
  if ([...required].some(name => !viewColumns.has(name)))
    throw new Error("CDC_MYSQL_VIEW_CONTRACT_INCOMPLETE");
  const view = quoteIdentifier("ingest_stage") + "." + quoteIdentifier("v_" + feed);
  const order = format.naturalKey.map(quoteIdentifier).join(", ");
  const select = projection.map(quoteIdentifier).join(", ");
  return {
    sql: "SELECT " + select + " FROM " + view +
      " WHERE " + quoteIdentifier("employer_ref") + " = ?" +
      " ORDER BY " + order + " LIMIT ?",
    params: [employerRef, maxRows + 1],
    projection,
  };
}

export async function readCdcMysqlView(
  feed: string, employerRef: string, scope: VerifiedEmployerScope,
  settings: CdcMysqlReaderSettings, connect: CdcMysqlConnector = connectReadOnly,
): Promise<CdcMysqlFeedRead> {
  validateSettings(settings);
  validateRequest(feed, employerRef, scope);
  let db: CdcMysqlQueryConnection | null = null;
  let inTransaction = false;
  try {
    db = await connect(settings);
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await db.query("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY");
    inTransaction = true;
    const [metadata] = await db.query({
      sql: "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
      timeout: settings.queryTimeoutMs,
    }, ["ingest_stage", "v_" + feed]);
    const planned = buildCdcMysqlViewQuery(
      feed, employerRef, columnNames(metadata), settings.maxRows,
    );
    const [results] = await db.query({
      sql: planned.sql, timeout: settings.queryTimeoutMs,
    }, planned.params);
    if (!Array.isArray(results) || results.length > settings.maxRows)
      throw new Error("CDC_MYSQL_REPORT_EXCEEDS_BUDGET");
    const records: SourceRow[] = results.map(row => {
      if (!row || typeof row !== "object" ||
          (row as SourceRow).employer_ref !== employerRef)
        throw new Error("CDC_MYSQL_EMPLOYER_SCOPE_MISMATCH");
      const value = row as SourceRow;
      return Object.fromEntries(planned.projection.map(key => [key, value[key]]));
    });
    // Do not claim a complete feed until every result passed the budget/scope checks.
    await db.query("ROLLBACK");
    inTransaction = false;
    return { feed, employerRef, records, complete: true, source: "MYSQL_READ_ONLY" };
  } catch {
    // Never leak DB connection strings, raw rows or SQL errors in responses.
    throw new Error("CDC_MYSQL_VIEW_READ_FAILED");
  } finally {
    if (db) {
      if (inTransaction) {
        try { await db.query("ROLLBACK"); } catch { /* Connection will be closed. */ }
      }
      try { await db.end(); } catch { throw new Error("CDC_MYSQL_VIEW_READ_FAILED"); }
    }
  }
}
