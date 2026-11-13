/**
 * Read-only discovery of employer identity anchors in canonical MySQL views.
 * This deliberately does NOT import workforce or reporting facts into Postgres.
 * Admins may separately approve minimal employer identities for app tenancy.
 */
import { effectiveSourceConfig, type IntegrationSourceConfig } from "./sourceAdapter.js";
import { directReportingEnabled } from "./directMysqlReporting.js";

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
export interface DirectEmployerPage {
  source: "MYSQL";
  employers: Array<{ employerRef: string; name: string }>;
  nextAfter: string | null;
  copiedToPostgres: false;
}

export async function discoverDirectMysqlEmployers(
  config: IntegrationSourceConfig,
  after: string | null = null,
): Promise<DirectEmployerPage> {
  if (!directReportingEnabled()) throw new Error("Direct MySQL reporting is disabled");
  if (after !== null && (!after || after.length > 128)) throw new Error("Invalid employer cursor");
  const src = effectiveSourceConfig(config);
  if (String(src.sourceMode ?? "").toUpperCase() !== "SQL" ||
      String(src.sqlDialect ?? "").toUpperCase() !== "MYSQL" ||
      src.sqlSsl !== true || src.sqlTrustServerCertificate === true)
    throw new Error("Verified-TLS MySQL reporting source is required");
  if (!src.sqlHost || !/^[A-Za-z0-9.-]{1,253}$/.test(src.sqlHost) ||
      !src.sqlDatabase || !src.sqlUsername || !src.sqlPassword ||
      !IDENT.test(src.sqlDatabase)) throw new Error("Invalid reporting source configuration");
  const port = Number(src.sqlPort ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid MySQL port");
  const view = (src.sqlViewPrefix ?? "v_") + "employers";
  if (!IDENT.test(view)) throw new Error("Invalid reporting view name");
  const mysql = await import("mysql2/promise");
  const connection = await mysql.createConnection({
    host: src.sqlHost, port, database: src.sqlDatabase,
    user: src.sqlUsername, password: src.sqlPassword,
    ssl: { rejectUnauthorized: true }, connectTimeout: 10_000,
    multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true,
  });
  try {
    await connection.query("SET TRANSACTION READ ONLY");
    await connection.query("START TRANSACTION");
    const [rows] = await connection.query({
      sql: `SELECT employer_ref, name FROM \`${src.sqlDatabase}\`.\`${view}\`
        WHERE (? IS NULL OR employer_ref > ?)
        ORDER BY employer_ref ASC LIMIT 101`,
      timeout: 10_000,
    }, [after, after]);
    const all = rows as Array<{ employer_ref: unknown; name: unknown }>;
    const slice = all.slice(0, 100);
    const employers = slice.map(row => ({
      employerRef: String(row.employer_ref), name: String(row.name),
    }));
    return {
      source: "MYSQL", employers,
      nextAfter: all.length > 100 ? employers[employers.length - 1].employerRef : null,
      copiedToPostgres: false,
    };
  } finally {
    try { await connection.query("ROLLBACK"); }
    finally { await connection.end(); }
  }
}
