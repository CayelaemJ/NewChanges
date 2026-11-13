/**
 * Schema-only AWS MySQL source-reporting readiness check.
 *
 * Queries INFORMATION_SCHEMA metadata only. No row scans, no schema writes,
 * no business-data copying, and no credentials in the response.
 * Historical data completeness still requires separate parity tests.
 */
import { effectiveSourceConfig, type IntegrationSourceConfig } from "./sourceAdapter.js";
import { directReportingEnabled } from "./directMysqlReporting.js";

const REQUIRED: Record<string, readonly string[]> = {
  v_employers: ["employer_ref", "name", "source_updated_at"],
  v_employees: ["employer_ref", "payroll_ref", "observed_at", "eligible_from", "source_updated_at"],
  v_platform_users: ["employer_ref", "payroll_ref", "enrolled_at", "source_updated_at"],
  v_journeys: ["employer_ref", "started_at", "status", "monthly_saving_rand", "source_updated_at"],
  v_ratings: ["employer_ref", "created_at", "stars", "source_updated_at"],
  v_referrals: ["employer_ref", "shared_at", "converted", "source_updated_at"],
  v_salary_advances: ["employer_ref", "advanced_at", "salary_advance_status", "amount", "source_updated_at"],
  v_workforce_snapshots: ["employer_ref", "as_of_date", "eligible_count", "source_updated_at"],
  v_debt_accounts: ["employer_ref", "account_ref", "observed_at", "source_updated_at",
    "balance_rand", "in_arrears", "closed_at", "is_deleted"],
  v_policies: ["employer_ref", "policy_ref", "observed_at", "source_updated_at",
    "premium_rand", "is_wasteful", "is_resolved", "effective_from", "effective_to", "is_deleted"],
};

export interface MySqlReportingPreflight {
  ready: boolean;
  productionCutoverReady: false;
  checkedAt: string;
  database: string;
  checks: Array<{
    view: string;
    present: boolean;
    isView: boolean;
    missingColumns: string[];
    compatible: boolean;
  }>;
  caveats: string[];
}

export async function inspectMysqlReportingReadiness(
  config: IntegrationSourceConfig,
): Promise<MySqlReportingPreflight> {
  if (!directReportingEnabled()) throw new Error("Direct reporting is disabled");
  const source = effectiveSourceConfig(config);
  if (String(source.sourceMode ?? "").toUpperCase() !== "SQL" ||
    String(source.sqlDialect ?? "").toUpperCase() !== "MYSQL" ||
    source.sqlSsl !== true || source.sqlTrustServerCertificate === true)
    throw new Error("Verified-TLS MySQL reporting configuration is required");
  if (!source.sqlHost || !/^[A-Za-z0-9.-]{1,253}$/.test(source.sqlHost) ||
      !source.sqlUsername || !source.sqlPassword ||
      !source.sqlDatabase || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(source.sqlDatabase))
    throw new Error("Invalid reporting connection");
  const port = Number(source.sqlPort ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port");
  const prefix = source.sqlViewPrefix ?? "v_";
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(prefix)) throw new Error("Invalid view prefix");

  const mysql = await import("mysql2/promise");
  const connection = await mysql.createConnection({
    host: source.sqlHost, port, database: source.sqlDatabase,
    user: source.sqlUsername, password: source.sqlPassword,
    ssl: { rejectUnauthorized: true }, connectTimeout: 10_000,
    multipleStatements: false,
  });
  try {
    const keys = Object.keys(REQUIRED);
    const viewNames = keys.map(k => prefix + k.slice(2));
    const placeholders = keys.map(() => "?").join(",");
    // Constant SQL, bound database/schema and allowlisted view identifiers.
    const [tableRows] = await connection.query({
      sql: `SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})`, timeout: 10_000,
    }, [source.sqlDatabase, ...viewNames]);
    const [columnRows] = await connection.query({
      sql: `SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN (${placeholders})`, timeout: 10_000,
    }, [source.sqlDatabase, ...viewNames]);
    const types = new Map<string, string>(
      (tableRows as Array<{ TABLE_NAME: string; TABLE_TYPE: string }>)
        .map(row => [row.TABLE_NAME, row.TABLE_TYPE] as const),
    );
    const columns = new Map<string, Set<string>>();
    for (const row of columnRows as Array<{ TABLE_NAME: string; COLUMN_NAME: string }>) {
      if (!columns.has(row.TABLE_NAME)) columns.set(row.TABLE_NAME, new Set());
      columns.get(row.TABLE_NAME)!.add(row.COLUMN_NAME.toLowerCase());
    }
    const checks = keys.map((key, index) => {
      const view = viewNames[index];
      const present = types.has(view);
      const isView = types.get(view) === "VIEW";
      const actual = columns.get(view) ?? new Set<string>();
      const missingColumns = REQUIRED[key].filter(column => !actual.has(column));
      return { view, present, isView, missingColumns, compatible: present && isView && missingColumns.length === 0 };
    });
    return {
      ready: checks.every(x => x.compatible),
      // Schema presence is NOT equivalent to dashboard parity or safe cutover.
      // A separate integration/cutover gate must be implemented and verified.
      productionCutoverReady: false,
      checkedAt: new Date().toISOString(),
      database: source.sqlDatabase,
      checks,
      caveats: [
        "Metadata readiness does not prove historical observation completeness or KPI parity.",
        "MySQL credentials must be restricted to SELECT on approved reporting views.",
        "Do not switch production dashboard or no-replication mode until temporal and tenant tests pass.",
      ],
    };
  } finally {
    await connection.end();
  }
}
