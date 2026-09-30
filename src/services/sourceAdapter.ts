// ════════════════════════════════════════════════════════════════════
//  EXTERNAL SOURCE ADAPTERS
//
//  The empower-fin Dashboard Portal can ingest the canonical 10 core feeds from either:
//    • HTTP API endpoints (bearer-token JSON), or
//    • read-only SQL views in PostgreSQL, Microsoft SQL Server or MySQL.
//
//  Both modes return the same canonical rows to syncService, which means SQL
//  can never bypass validation, natural-key upserts, dated history or dashboard
//  calculations.
// ════════════════════════════════════════════════════════════════════

import { LOAD_ORDER, getFormat } from "./reportFormats.js";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export type SourceMode = "API" | "SQL";
export type SqlDialect = "POSTGRESQL" | "MSSQL" | "MYSQL";

export interface SourceWindow {
  since?: Date | null;
  through?: Date;
}

export interface SourceFetchResult {
  records: Record<string, unknown>[];
  location: string;
}

export interface IntegrationSourceConfig {
  sourceMode?: string | null;
  baseUrl?: string | null;
  authToken?: string | null;
  sqlDialect?: string | null;
  sqlHost?: string | null;
  sqlPort?: number | null;
  sqlDatabase?: string | null;
  sqlSchema?: string | null;
  sqlUsername?: string | null;
  sqlPassword?: string | null;
  sqlSsl?: boolean | null;
  sqlTrustServerCertificate?: boolean | null;
  sqlViewPrefix?: string | null;
  sqlQueryTimeoutMs?: number | null;
  sqlMaxRowsPerReport?: number | null;
  sqlReplicaEnabled?: boolean | null;
  sqlReplicaHost?: string | null;
  sqlReplicaPort?: number | null;
  sqlReplicaDatabase?: string | null;
  sqlReplicaSchema?: string | null;
  sqlReplicaUsername?: string | null;
  sqlReplicaPassword?: string | null;
  sqlReplicaSsl?: boolean | null;
  sqlReplicaTrustServerCertificate?: boolean | null;
  sqlReplicaMaxLagSeconds?: number | null;
}

export interface SourceAdapter {
  mode: SourceMode;
  label: string;
  fetchReport(reportKey: string, window?: SourceWindow, sourceViewOverride?: string | null, options?: { useReplica?: boolean }): Promise<SourceFetchResult>;
  test(): Promise<{ ok: true; note: string; details?: unknown }>;
  describe?(reportKey: string): Promise<{ database: string | null; totalRows: number; newest: string | null; location: string }>;
  close(): Promise<void>;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

function intSetting(value: number | null | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

function boolEnv(name: string): boolean | undefined {
  const raw = process.env[name];
  if (raw == null || raw === "") return undefined;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

function numberEnv(name: string): number | undefined {
  const raw = process.env[name];
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function withEnvironment(config: IntegrationSourceConfig): IntegrationSourceConfig {
  return {
    ...config,
    baseUrl: process.env.SOURCE_API_BASE_URL || config.baseUrl,
    authToken: process.env.SOURCE_API_TOKEN || config.authToken,
    sqlDialect: process.env.SOURCE_SQL_DIALECT || config.sqlDialect,
    sqlHost: process.env.SOURCE_SQL_HOST || config.sqlHost,
    sqlPort: numberEnv("SOURCE_SQL_PORT") ?? config.sqlPort,
    sqlDatabase: process.env.SOURCE_SQL_DATABASE || config.sqlDatabase,
    sqlSchema: process.env.SOURCE_SQL_SCHEMA ?? config.sqlSchema,
    sqlUsername: process.env.SOURCE_SQL_USERNAME || config.sqlUsername,
    sqlPassword: process.env.SOURCE_SQL_PASSWORD || config.sqlPassword,
    sqlSsl: boolEnv("SOURCE_SQL_SSL") ?? config.sqlSsl,
    sqlTrustServerCertificate: boolEnv("SOURCE_SQL_TRUST_SERVER_CERTIFICATE") ?? config.sqlTrustServerCertificate,
    sqlViewPrefix: process.env.SOURCE_SQL_VIEW_PREFIX || config.sqlViewPrefix,
    sqlQueryTimeoutMs: numberEnv("SOURCE_SQL_QUERY_TIMEOUT_MS") ?? config.sqlQueryTimeoutMs,
    sqlMaxRowsPerReport: numberEnv("SOURCE_SQL_MAX_ROWS_PER_REPORT") ?? config.sqlMaxRowsPerReport,
    sqlReplicaEnabled: boolEnv("SOURCE_SQL_REPLICA_ENABLED") ?? config.sqlReplicaEnabled,
    sqlReplicaHost: process.env.SOURCE_SQL_REPLICA_HOST || config.sqlReplicaHost,
    sqlReplicaPort: numberEnv("SOURCE_SQL_REPLICA_PORT") ?? config.sqlReplicaPort,
    sqlReplicaDatabase: process.env.SOURCE_SQL_REPLICA_DATABASE || config.sqlReplicaDatabase,
    sqlReplicaSchema: process.env.SOURCE_SQL_REPLICA_SCHEMA ?? config.sqlReplicaSchema,
    sqlReplicaUsername: process.env.SOURCE_SQL_REPLICA_USERNAME || config.sqlReplicaUsername,
    sqlReplicaPassword: process.env.SOURCE_SQL_REPLICA_PASSWORD || config.sqlReplicaPassword,
    sqlReplicaSsl: boolEnv("SOURCE_SQL_REPLICA_SSL") ?? config.sqlReplicaSsl,
    sqlReplicaTrustServerCertificate: boolEnv("SOURCE_SQL_REPLICA_TRUST_SERVER_CERTIFICATE") ?? config.sqlReplicaTrustServerCertificate,
    sqlReplicaMaxLagSeconds: numberEnv("SOURCE_SQL_REPLICA_MAX_LAG_SECONDS") ?? config.sqlReplicaMaxLagSeconds,
  };
}

function cleanIdentifier(value: string | null | undefined, label: string, allowBlank = false): string {
  const v = String(value ?? "").trim();
  if (!v && allowBlank) return "";
  if (!IDENTIFIER.test(v)) throw new Error(`${label} must contain only letters, numbers and underscores and must not start with a number.`);
  return v;
}

export function configuredSourceMode(config: IntegrationSourceConfig): SourceMode {
  const raw = String(process.env.SOURCE_MODE ?? config.sourceMode ?? "API").trim().toUpperCase();
  if (raw !== "API" && raw !== "SQL") throw new Error(`Unsupported source mode "${raw}". Use API or SQL.`);
  return raw;
}

export function sourceIsConfigured(config: IntegrationSourceConfig): boolean {
  const mode = configuredSourceMode(config);
  const effective = withEnvironment(config);
  if (mode === "API") return Boolean(effective.baseUrl);
  return Boolean(effective.sqlHost && effective.sqlDatabase && effective.sqlUsername && effective.sqlPassword);
}

function canonicalViewParts(config: IntegrationSourceConfig, reportKey: string): { schema: string; view: string } {
  const schema = cleanIdentifier(config.sqlSchema, "SQL schema", true);
  const prefix = cleanIdentifier(config.sqlViewPrefix ?? "v_", "SQL view prefix");
  const report = cleanIdentifier(reportKey, "report key");
  return { schema, view: `${prefix}${report}` };
}

function formatSqlLocation(config: IntegrationSourceConfig, reportKey: string): string {
  const { schema, view } = canonicalViewParts(config, reportKey);
  return schema ? `${schema}.${view}` : view;
}

function normalizeSqlValue(type: string, value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "bigint") return value.toString();
  if (Buffer.isBuffer(value)) return value.toString("utf-8");

  if (type === "date") {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    const text = String(value).trim();
    const isoDate = text.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    return isoDate ?? text;
  }

  if (type === "datetime") {
    if (value instanceof Date) return value.toISOString();
    const text = String(value).trim();
    // Some drivers expose an ISO timestamp without a timezone only when the
    // source view used a timezone-naive type. Do not silently guess UTC here;
    // validation must reject it so the source view can be corrected.
    return text;
  }

  return value;
}

function normalizeSqlRows(reportKey: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const format = getFormat(reportKey);
  if (!format) throw new Error(`Unknown report: ${reportKey}`);

  return rows.map((row) => {
    const lower = new Map<string, unknown>();
    for (const [key, value] of Object.entries(row)) lower.set(key.toLowerCase(), value);
    const out: Record<string, unknown> = {};
    for (const field of format.fields) {
      if (!lower.has(field.name.toLowerCase())) continue;
      out[field.name] = normalizeSqlValue(field.type, lower.get(field.name.toLowerCase()));
    }
    return out;
  });
}

function privateOrLocalAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    return a === "::1" || a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe8") || a.startsWith("fe9") || a.startsWith("fea") || a.startsWith("feb") || a.startsWith("::ffff:127.") || a.startsWith("::ffff:10.") || a.startsWith("::ffff:192.168.") || a.startsWith("::ffff:172.16.");
  }
  if (isIP(address) === 4) {
    const [a,b] = address.split(".").map(Number);
    return a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a === 0;
  }
  return false;
}

async function assertSafeApiBaseUrl(raw: string): Promise<string> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error("API base URL must be a valid URL."); }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("API base URL must use HTTP or HTTPS.");
  if (url.username || url.password || url.hash) throw new Error("API base URL must not contain credentials or fragments.");
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".local") || hostname === "metadata.google.internal") {
    throw new Error("API base URL hostname is not allowed.");
  }
  const allow = String(process.env.SOURCE_API_ALLOWED_HOSTS || "").split(",").map(v => v.trim().toLowerCase()).filter(Boolean);
  if (allow.length && !allow.some(h => hostname === h || (h.startsWith("*.") && hostname.endsWith(h.slice(1))))) {
    throw new Error("API base URL hostname is not on SOURCE_API_ALLOWED_HOSTS.");
  }
  if (privateOrLocalAddress(hostname)) throw new Error("API base URL must not target a private, loopback, link-local or reserved IP address.");
  try {
    const addresses = await lookup(hostname, { all: true });
    if (addresses.some(a => privateOrLocalAddress(a.address))) {
      throw new Error("API base URL resolves to a private, loopback, link-local or reserved address.");
    }
  } catch (error: any) {
    if (error?.code || /resolv|ENOTFOUND|EAI_/i.test(String(error?.message ?? ""))) {
      throw new Error("API base URL hostname could not be safely resolved.");
    }
    throw error;
  }
  return url.toString().replace(/\/$/, "");
}

async function createApiAdapter(config: IntegrationSourceConfig): Promise<SourceAdapter> {
  const rawBaseUrl = String(config.baseUrl ?? "").trim();
  if (!rawBaseUrl) throw new Error("No API base URL configured.");
  const baseUrl = await assertSafeApiBaseUrl(rawBaseUrl);
  const token = process.env.SOURCE_API_TOKEN || config.authToken || null;

  async function fetchReport(reportKey: string, window?: SourceWindow): Promise<SourceFetchResult> {
    const root = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
    const url = new URL(`api/empower-fin/${reportKey}`, root);
    if (window?.since) url.searchParams.set("since", window.since.toISOString());
    if (window?.through) url.searchParams.set("through", window.through.toISOString());

    const response = await fetch(url, {
      headers: token
        ? { Authorization: `Bearer ${token}`, Accept: "application/json" }
        : { Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
      redirect: "error",
    });
    if (!response.ok) throw new Error(`HTTP ${response.status} from ${reportKey} endpoint`);

    const body: any = await response.json();
    const records = Array.isArray(body) ? body : body?.records;
    if (!Array.isArray(records)) throw new Error(`${reportKey}: response missing "records" array`);
    return { records, location: url.toString() };
  }

  return {
    mode: "API",
    label: `API ${baseUrl}`,
    fetchReport,
    async test() {
      const result = await fetchReport("employers", { through: new Date() });
      return { ok: true, note: `Connected to API. The employers endpoint returned ${result.records.length} record(s).` };
    },
    async close() {},
  };
}

interface SqlQueryResult {
  rows: Record<string, unknown>[];
  columns: string[];
}

interface SqlExecutor {
  dialect: SqlDialect;
  queryReport(reportKey: string, window: SourceWindow, maxRows: number, sourceViewOverride?: string | null): Promise<SqlQueryResult>;
  probe(reportKey: string): Promise<string[]>;
  describe(reportKey: string): Promise<{ database: string | null; totalRows: number; newest: string | null }>;
  close(): Promise<void>;
}

function quoteSqlIdentifier(dialect: SqlDialect, identifier: string): string {
  cleanIdentifier(identifier, "SQL identifier");
  if (dialect === "MSSQL") return `[${identifier}]`;
  if (dialect === "MYSQL") return `\`${identifier}\``;
  return `"${identifier}"`;
}

function qualifiedView(dialect: SqlDialect, config: IntegrationSourceConfig, reportKey: string, sourceViewOverride?: string | null): string {
  const { schema, view } = canonicalViewParts(config, reportKey);
  const selected = String(sourceViewOverride || view).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(selected)) throw new Error("source analytics view contains unsafe characters.");
  const parts = selected.split(".");
  const qView = parts.length === 2
    ? `${quoteSqlIdentifier(dialect, parts[0])}.${quoteSqlIdentifier(dialect, parts[1])}`
    : quoteSqlIdentifier(dialect, selected);
  return schema ? `${quoteSqlIdentifier(dialect, schema)}.${qView}` : qView;
}

async function openPostgresExecutor(config: IntegrationSourceConfig): Promise<SqlExecutor> {
  const pg: any = await import("pg");
  const Client = pg.Client ?? pg.default?.Client;
  if (!Client) throw new Error("The pg driver could not be loaded.");

  const queryTimeout = intSetting(config.sqlQueryTimeoutMs, 60_000, 1_000, 600_000);
  const sslEnabled = boolEnv("SOURCE_SQL_SSL") ?? config.sqlSsl ?? true;
  const trust = boolEnv("SOURCE_SQL_TRUST_SERVER_CERTIFICATE") ?? config.sqlTrustServerCertificate ?? false;
  const client = new Client({
    host: config.sqlHost,
    port: intSetting(config.sqlPort, 5432, 1, 65535),
    database: config.sqlDatabase,
    user: config.sqlUsername,
    password: process.env.SOURCE_SQL_PASSWORD || config.sqlPassword,
    ssl: sslEnabled ? { rejectUnauthorized: !trust } : false,
    connectionTimeoutMillis: Math.min(queryTimeout, 60_000),
    statement_timeout: queryTimeout,
    application_name: "empower-fin-dashboard-source",
  });
  await client.connect();

  return {
    dialect: "POSTGRESQL",
    async queryReport(reportKey, window, maxRows, sourceViewOverride) {
      const view = qualifiedView("POSTGRESQL", config, reportKey, sourceViewOverride);
      const params: unknown[] = [];
      const where: string[] = [];
      if (window.since) { params.push(window.since); where.push(`source_updated_at > $${params.length}`); }
      if (window.through) { params.push(window.through); where.push(`source_updated_at <= $${params.length}`); }
      params.push(maxRows + 1);
      const sql = `SELECT * FROM ${view}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY source_updated_at ASC LIMIT $${params.length}`;
      const result = await client.query(sql, params);
      return { rows: result.rows, columns: result.fields?.map((f: any) => String(f.name)) ?? [] };
    },
    async probe(reportKey) {
      const view = qualifiedView("POSTGRESQL", config, reportKey);
      const result = await client.query(`SELECT * FROM ${view} WHERE 1 = 0`);
      return result.fields?.map((f: any) => String(f.name)) ?? [];
    },
    async describe(reportKey) {
      const view = qualifiedView("POSTGRESQL", config, reportKey);
      const r = await client.query(`SELECT current_database() AS db, COUNT(*)::text AS n, MAX(source_updated_at)::text AS newest FROM ${view}`);
      const row = r.rows[0] ?? {};
      return { database: row.db ?? null, totalRows: Number(row.n ?? 0), newest: row.newest ?? null };
    },
    async close() { await client.end(); },
  };
}

async function openMysqlExecutor(config: IntegrationSourceConfig): Promise<SqlExecutor> {
  const mysql: any = await import("mysql2/promise");
  const createConnection = mysql.createConnection ?? mysql.default?.createConnection;
  if (!createConnection) throw new Error("The mysql2 driver could not be loaded.");

  const queryTimeout = intSetting(config.sqlQueryTimeoutMs, 60_000, 1_000, 600_000);
  const sslEnabled = boolEnv("SOURCE_SQL_SSL") ?? config.sqlSsl ?? true;
  const trust = boolEnv("SOURCE_SQL_TRUST_SERVER_CERTIFICATE") ?? config.sqlTrustServerCertificate ?? false;
  const connection = await createConnection({
    host: config.sqlHost,
    port: intSetting(config.sqlPort, 3306, 1, 65535),
    database: config.sqlDatabase,
    user: config.sqlUsername,
    password: process.env.SOURCE_SQL_PASSWORD || config.sqlPassword,
    connectTimeout: Math.min(queryTimeout, 60_000),
    ssl: sslEnabled ? { rejectUnauthorized: !trust } : undefined,
    dateStrings: false,
    timezone: "Z",
  });

  return {
    dialect: "MYSQL",
    async queryReport(reportKey, window, maxRows, sourceViewOverride) {
      const view = qualifiedView("MYSQL", config, reportKey, sourceViewOverride);
      const params: unknown[] = [];
      const where: string[] = [];
      if (window.since) { params.push(window.since); where.push("source_updated_at > ?"); }
      if (window.through) { params.push(window.through); where.push("source_updated_at <= ?"); }
      params.push(maxRows + 1);
      const sql = `SELECT * FROM ${view}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY source_updated_at ASC LIMIT ?`;
      const [rows, fields] = await connection.query({ sql, timeout: queryTimeout }, params);
      return {
        rows: Array.isArray(rows) ? rows as Record<string, unknown>[] : [],
        columns: Array.isArray(fields) ? fields.map((f: any) => String(f.name)) : [],
      };
    },
    async probe(reportKey) {
      const view = qualifiedView("MYSQL", config, reportKey);
      const [, fields] = await connection.query({ sql: `SELECT * FROM ${view} WHERE 1 = 0`, timeout: queryTimeout });
      return Array.isArray(fields) ? fields.map((f: any) => String(f.name)) : [];
    },
    async describe(reportKey) {
      const view = qualifiedView("MYSQL", config, reportKey);
      const [rows]: any = await connection.query({ sql: `SELECT DATABASE() AS db, COUNT(*) AS n, CAST(MAX(source_updated_at) AS CHAR) AS newest FROM ${view}`, timeout: queryTimeout });
      const row = Array.isArray(rows) ? rows[0] ?? {} : {};
      return { database: row.db ?? null, totalRows: Number(row.n ?? 0), newest: row.newest ?? null };
    },
    async close() { await connection.end(); },
  };
}

async function openMssqlExecutor(config: IntegrationSourceConfig): Promise<SqlExecutor> {
  const mssql: any = await import("mssql");
  const ConnectionPool = mssql.ConnectionPool ?? mssql.default?.ConnectionPool;
  if (!ConnectionPool) throw new Error("The mssql driver could not be loaded.");

  const queryTimeout = intSetting(config.sqlQueryTimeoutMs, 60_000, 1_000, 600_000);
  const encrypt = boolEnv("SOURCE_SQL_SSL") ?? config.sqlSsl ?? true;
  const trust = boolEnv("SOURCE_SQL_TRUST_SERVER_CERTIFICATE") ?? config.sqlTrustServerCertificate ?? false;
  const pool = await new ConnectionPool({
    server: config.sqlHost,
    port: intSetting(config.sqlPort, 1433, 1, 65535),
    database: config.sqlDatabase,
    user: config.sqlUsername,
    password: process.env.SOURCE_SQL_PASSWORD || config.sqlPassword,
    connectionTimeout: Math.min(queryTimeout, 60_000),
    requestTimeout: queryTimeout,
    pool: { max: 3, min: 0, idleTimeoutMillis: 30_000 },
    options: { encrypt, trustServerCertificate: trust, enableArithAbort: true, useUTC: true },
  }).connect();

  return {
    dialect: "MSSQL",
    async queryReport(reportKey, window, maxRows, sourceViewOverride) {
      const view = qualifiedView("MSSQL", config, reportKey, sourceViewOverride);
      const request = pool.request();
      request.input("limit", mssql.Int, maxRows + 1);
      const where: string[] = [];
      if (window.since) { request.input("since", mssql.DateTimeOffset, window.since); where.push("source_updated_at > @since"); }
      if (window.through) { request.input("through", mssql.DateTimeOffset, window.through); where.push("source_updated_at <= @through"); }
      const sql = `SELECT TOP (@limit) * FROM ${view}${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY source_updated_at ASC`;
      const result = await request.query(sql);
      const rows = Array.isArray(result.recordset) ? result.recordset as Record<string, unknown>[] : [];
      const columns = result.recordset?.columns ? Object.keys(result.recordset.columns) : (rows[0] ? Object.keys(rows[0]) : []);
      return { rows, columns };
    },
    async probe(reportKey) {
      const view = qualifiedView("MSSQL", config, reportKey);
      const result = await pool.request().query(`SELECT TOP (0) * FROM ${view}`);
      if (result.recordset?.columns) return Object.keys(result.recordset.columns);
      return [];
    },
    async describe(reportKey) {
      const view = qualifiedView("MSSQL", config, reportKey);
      const r = await pool.request().query(`SELECT DB_NAME() AS db, COUNT(*) AS n, CONVERT(varchar(40), MAX(source_updated_at), 127) AS newest FROM ${view}`);
      const row: any = r.recordset?.[0] ?? {};
      return { database: row.db ?? null, totalRows: Number(row.n ?? 0), newest: row.newest ?? null };
    },
    async close() { await pool.close(); },
  };
}

function effectiveReplicaEnabled(config: IntegrationSourceConfig): boolean {
  return Boolean(config.sqlReplicaEnabled || process.env.SOURCE_SQL_REPLICA_ENABLED === "true");
}

export async function checkMysqlReadReplica(config: IntegrationSourceConfig): Promise<{ configured: boolean; reachable: boolean; readOnly: boolean | null; lagSeconds: number | null; lagWithinThreshold: boolean | null; host: string | null; database: string | null; note: string }> {
  const effective = withEnvironment(config);
  if (!effective.sqlReplicaHost || !effective.sqlReplicaUsername || !(process.env.SOURCE_SQL_REPLICA_PASSWORD || effective.sqlReplicaPassword)) {
    return { configured: false, reachable: false, readOnly: null, lagSeconds: null, lagWithinThreshold: null, host: effective.sqlReplicaHost ?? null, database: effective.sqlReplicaDatabase ?? effective.sqlDatabase ?? null, note: "No read replica is configured." };
  }
  if (sqlDialect(effective) !== "MYSQL") return { configured: true, reachable: false, readOnly: null, lagSeconds: null, lagWithinThreshold: null, host: effective.sqlReplicaHost, database: effective.sqlReplicaDatabase ?? effective.sqlDatabase ?? null, note: "Replica health currently supports MySQL source replicas only." };
  const mysql: any = await import("mysql2/promise");
  const createConnection = mysql.createConnection ?? mysql.default?.createConnection;
  const connection = await createConnection({ host: effective.sqlReplicaHost, port: intSetting(effective.sqlReplicaPort, 3306, 1, 65535), database: effective.sqlReplicaDatabase ?? effective.sqlDatabase, user: effective.sqlReplicaUsername, password: process.env.SOURCE_SQL_REPLICA_PASSWORD || effective.sqlReplicaPassword, connectTimeout: 15000, ssl: (effective.sqlReplicaSsl ?? true) ? { rejectUnauthorized: !(effective.sqlReplicaTrustServerCertificate ?? false) } : undefined });
  try {
    await connection.query("SELECT 1");
    const [vars]: any = await connection.query("SHOW VARIABLES WHERE Variable_name IN ('read_only','super_read_only')");
    const flags = Object.fromEntries((vars || []).map((x: any) => [String(x.Variable_name).toLowerCase(), String(x.Value).toLowerCase()]));
    const readOnly = flags.read_only === "on" && (flags.super_read_only == null || flags.super_read_only === "on");
    let lagSeconds: number | null = null;
    try {
      const [rows]: any = await connection.query("SHOW REPLICA STATUS");
      const row = rows?.[0];
      if (row) lagSeconds = row.Seconds_Behind_Source == null ? null : Number(row.Seconds_Behind_Source);
    } catch {
      try { const [rows]: any = await connection.query("SHOW SLAVE STATUS"); const row = rows?.[0]; if (row) lagSeconds = row.Seconds_Behind_Master == null ? null : Number(row.Seconds_Behind_Master); } catch {}
    }
    const threshold = intSetting(effective.sqlReplicaMaxLagSeconds, 60, 0, 86400);
    const lagWithinThreshold = lagSeconds == null ? null : lagSeconds <= threshold;
    const healthy = readOnly && (lagWithinThreshold !== false);
    return { configured: true, reachable: true, readOnly, lagSeconds, lagWithinThreshold, host: effective.sqlReplicaHost, database: effective.sqlReplicaDatabase ?? effective.sqlDatabase ?? null, note: healthy ? "Replica is reachable, read-only, and within the configured lag threshold." : "Replica requires attention: verify read-only state and replication lag." };
  } finally { await connection.end(); }
}

function sqlDialect(config: IntegrationSourceConfig): SqlDialect {
  const raw = String(config.sqlDialect ?? "POSTGRESQL").trim().toUpperCase();
  if (raw === "POSTGRES" || raw === "PG") return "POSTGRESQL";
  if (raw === "SQLSERVER" || raw === "SQL_SERVER") return "MSSQL";
  if (raw !== "POSTGRESQL" && raw !== "MSSQL" && raw !== "MYSQL") {
    throw new Error(`Unsupported SQL dialect "${raw}". Use POSTGRESQL, MSSQL or MYSQL.`);
  }
  return raw;
}

async function createSqlAdapter(config: IntegrationSourceConfig): Promise<SourceAdapter> {
  if (!config.sqlHost) throw new Error("SQL host is required.");
  if (!config.sqlDatabase) throw new Error("SQL database/catalog is required.");
  if (!config.sqlUsername) throw new Error("SQL read-only username is required.");
  if (!(process.env.SOURCE_SQL_PASSWORD || config.sqlPassword)) throw new Error("SQL password is required. Set it in Admin or SOURCE_SQL_PASSWORD.");

  const dialect = sqlDialect(config);
  const maxRows = intSetting(config.sqlMaxRowsPerReport, 250_000, 1, 2_000_000);
  let executor: SqlExecutor;
  let replicaExecutor: SqlExecutor | null = null;
  try {
    if (dialect === "POSTGRESQL") executor = await openPostgresExecutor(config);
    else if (dialect === "MYSQL") executor = await openMysqlExecutor(config);
    else executor = await openMssqlExecutor(config);

    if (effectiveReplicaEnabled(config)) {
      const replicaConfig: IntegrationSourceConfig = {
        ...config,
        sqlHost: config.sqlReplicaHost,
        sqlPort: config.sqlReplicaPort ?? config.sqlPort,
        sqlDatabase: config.sqlReplicaDatabase ?? config.sqlDatabase,
        sqlSchema: config.sqlReplicaSchema ?? config.sqlSchema,
        sqlUsername: config.sqlReplicaUsername,
        sqlPassword: config.sqlReplicaPassword,
        sqlSsl: config.sqlReplicaSsl,
        sqlTrustServerCertificate: config.sqlReplicaTrustServerCertificate,
      };
      if (!replicaConfig.sqlHost || !replicaConfig.sqlUsername || !(process.env.SOURCE_SQL_REPLICA_PASSWORD || replicaConfig.sqlPassword)) {
        throw new Error("Source analytics read replica is enabled but host, username or password is missing.");
      }
      if (dialect === "MYSQL") replicaExecutor = await openMysqlExecutor(replicaConfig);
      else if (dialect === "POSTGRESQL") replicaExecutor = await openPostgresExecutor(replicaConfig);
      else replicaExecutor = await openMssqlExecutor(replicaConfig);
    }
  } catch (error: any) {
    // A raw driver/protocol error here (garbled bytes, "unexpected message
    // from backend", immediate connection reset, etc.) almost always means
    // the configured dialect doesn't match what's actually listening on
    // sqlHost:sqlPort — e.g. the Postgres driver was used against a MySQL
    // server, or vice versa. Surface that plainly instead of the raw
    // driver internals, which read as an unexplained crash.
    const note = error?.message ?? String(error);
    throw new Error(`Could not open a ${dialect} connection to ${config.sqlHost}:${config.sqlPort ?? "(default port)"} — ${note}. If this looks like a protocol/handshake error rather than an auth or network error, double-check that "SQL platform" in Admin is actually set to the database engine you're running (and that Save settings was clicked after changing it), then re-test.`);
  }

  async function fetchReport(reportKey: string, window: SourceWindow = {}, sourceViewOverride?: string | null, options?: { useReplica?: boolean }): Promise<SourceFetchResult> {
    const selectedExecutor = options?.useReplica ? replicaExecutor : executor;
    if (options?.useReplica && !selectedExecutor) throw new Error("Read replica is required for " + reportKey + ", but no approved replica is configured.");
    const result = await (selectedExecutor ?? executor).queryReport(reportKey, window, maxRows, sourceViewOverride);
    if (result.rows.length > maxRows) {
      throw new Error(`${reportKey}: SQL extraction exceeded the configured ${maxRows.toLocaleString("en-ZA")} row safety limit for one sync window. Increase sync frequency or sqlMaxRowsPerReport.`);
    }
    return {
      records: normalizeSqlRows(reportKey, result.rows),
      location: `${dialect}${options?.useReplica ? "-REPLICA" : ""}:${formatSqlLocation(options?.useReplica && replicaExecutor ? { ...config, sqlSchema: config.sqlReplicaSchema ?? config.sqlSchema } : config, reportKey)}`,
    };
  }

  return {
    mode: "SQL",
    label: `${dialect} ${config.sqlHost}/${config.sqlDatabase}`,
    fetchReport,
    async describe(reportKey: string) {
      const d = await executor.describe(reportKey);
      return { ...d, location: `${dialect}:${config.sqlHost}:${config.sqlPort ?? "default"}/${d.database ?? config.sqlDatabase}.${formatSqlLocation(config, reportKey)}` };
    },
    async test() {
      const details: Record<string, unknown> = {};
      for (const reportKey of LOAD_ORDER) {
        const format = getFormat(reportKey)!;
        const columns = await executor.probe(reportKey);
        const available = new Set(columns.map((c) => c.toLowerCase()));
        const missing = format.fields.map((f) => f.name).filter((name) => !available.has(name.toLowerCase()));
        details[reportKey] = { view: formatSqlLocation(config, reportKey), columns: columns.length, missing };
        if (missing.length) {
          throw new Error(`${formatSqlLocation(config, reportKey)} is missing canonical column(s): ${missing.join(", ")}`);
        }
      }
      return {
        ok: true,
        note: `Connected to ${dialect}. All ${LOAD_ORDER.length} canonical SQL views are accessible and expose the contracted columns.`,
        details,
      };
    },
    async close() { await executor.close(); if (replicaExecutor) await replicaExecutor.close(); },
  };
}

export async function createSourceAdapter(config: IntegrationSourceConfig): Promise<SourceAdapter> {
  const mode = configuredSourceMode(config);
  const effective = withEnvironment(config);
  return mode === "SQL" ? createSqlAdapter(effective) : createApiAdapter(effective);
}