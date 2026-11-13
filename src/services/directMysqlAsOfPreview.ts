/**
 * Historical as-of source previews (not canonical financial score parity).
 *
 * Requires canonical MySQL reporting views retaining ALL dated observations;
 * a latest-state-only view is NOT sufficient. Nothing is copied to PostgreSQL.
 */
import type { IntegrationSourceConfig } from "./sourceAdapter.js";
import { effectiveSourceConfig } from "./sourceAdapter.js";
import { directReportingEnabled } from "./directMysqlReporting.js";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TIMEOUT = 12_000;

export interface DirectAsOfInput {
  employerRef: string;
  asOfDate: string; // inclusive YYYY-MM-DD
}
export interface DirectAsOfPreview {
  source: "MYSQL";
  mode: "AS_OF_PREVIEW";
  employerRef: string;
  asOfDate: string;
  workforce: { eligibleCount: string | null; observedAt: string | null };
  debts: { activeAccounts: string; outstandingBalanceRand: string; inArrearsAccounts: string };
  policies: { activePolicies: string; monthlyPremiumRand: string; wastefulPolicies: string };
  replicatedToPostgres: false;
}
function quoteIdentifier(input: string): string {
  if (!IDENTIFIER.test(input)) throw new Error("Invalid SQL identifier");
  return "`" + input + "`";
}
function checkDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
export async function readDirectAsOfPreview(
  config: IntegrationSourceConfig,
  input: DirectAsOfInput,
): Promise<DirectAsOfPreview> {
  if (!directReportingEnabled()) throw new Error("Direct reporting is disabled");
  const employerRef = String(input.employerRef ?? "").trim();
  const asOfDate = String(input.asOfDate ?? "");
  if (!employerRef || employerRef.length > 128) throw new Error("Employer is required");
  if (!checkDate(asOfDate)) throw new Error("Invalid as-of date");

  const source = effectiveSourceConfig(config);
  if (String(source.sourceMode ?? "").toUpperCase() !== "SQL" ||
      String(source.sqlDialect ?? "").toUpperCase() !== "MYSQL" ||
      source.sqlSsl !== true || source.sqlTrustServerCertificate === true)
    throw new Error("Verified-TLS MySQL source is required");
  if (!source.sqlHost || !/^[A-Za-z0-9.-]{1,253}$/.test(source.sqlHost) ||
      !source.sqlDatabase || !source.sqlUsername || !source.sqlPassword)
    throw new Error("Invalid source connection settings");
  const port = Number(source.sqlPort ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid MySQL port");
  const view = (key: string) => quoteIdentifier(source.sqlDatabase!) + "." +
    quoteIdentifier((source.sqlViewPrefix ?? "v_") + key);
  // Observed-at records are ranked BEFORE applying business lifecycle flags.
  // All as-of predicates are inclusive and values are bound separately.
  const workforceSql = `SELECT eligible_count AS eligibleCount, as_of_date AS observedAt
    FROM ${view("workforce_snapshots")}
    WHERE employer_ref = ? AND as_of_date <= ?
    ORDER BY as_of_date DESC, source_updated_at DESC LIMIT 1`;
  const debtSql = `SELECT COUNT(*) AS total,
    COALESCE(SUM(balance_rand),0) AS balance,
    COALESCE(SUM(CASE WHEN in_arrears = 1 THEN 1 ELSE 0 END),0) AS arrears
    FROM (
      SELECT account_ref, balance_rand, in_arrears, closed_at, is_deleted,
        ROW_NUMBER() OVER (
          PARTITION BY account_ref ORDER BY observed_at DESC, source_updated_at DESC
        ) AS rn
      FROM ${view("debt_accounts")}
      WHERE employer_ref = ? AND observed_at <= ?
    ) AS history
    WHERE rn = 1 AND (is_deleted IS NULL OR is_deleted = 0)
      AND (closed_at IS NULL OR closed_at > ?)`;
  const policySql = `SELECT COUNT(*) AS total,
    COALESCE(SUM(premium_rand),0) AS premium,
    COALESCE(SUM(CASE WHEN is_wasteful = 1 AND (is_resolved IS NULL OR is_resolved = 0)
      THEN 1 ELSE 0 END),0) AS wasteful
    FROM (
      SELECT policy_ref, premium_rand, is_wasteful, is_resolved,
        effective_from, effective_to, is_deleted,
        ROW_NUMBER() OVER (
          PARTITION BY policy_ref ORDER BY observed_at DESC, source_updated_at DESC
        ) AS rn
      FROM ${view("policies")}
      WHERE employer_ref = ? AND observed_at <= ?
    ) AS history
    WHERE rn = 1 AND (is_deleted IS NULL OR is_deleted = 0)
      AND (effective_from IS NULL OR effective_from <= ?)
      AND (effective_to IS NULL OR effective_to >= ?)`;

  const mysql = await import("mysql2/promise");
  const connection = await mysql.createConnection({
    host: source.sqlHost, port, database: source.sqlDatabase,
    user: source.sqlUsername, password: source.sqlPassword,
    ssl: { rejectUnauthorized: true }, connectTimeout: TIMEOUT,
    timezone: "Z", supportBigNumbers: true, bigNumberStrings: true,
    multipleStatements: false,
  });
  try {
    await connection.query("SET TRANSACTION READ ONLY");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    const query = async (sql: string, params: string[]) => {
      const [rows] = await connection.query({ sql, timeout: TIMEOUT }, params);
      return rows as Record<string, unknown>[];
    };
    const headcounts = await query(workforceSql, [employerRef, asOfDate]);
    const debts = await query(debtSql, [employerRef, asOfDate, asOfDate]);
    const policies = await query(policySql, [employerRef, asOfDate, asOfDate, asOfDate]);
    if (!debts[0] || !policies[0]) throw new Error("Incomplete MySQL aggregate response");
    const hc = headcounts[0];
    const observed = hc?.observedAt;
    return {
      source: "MYSQL", mode: "AS_OF_PREVIEW", employerRef, asOfDate,
      workforce: {
        eligibleCount: hc?.eligibleCount == null ? null : String(hc.eligibleCount),
        observedAt: observed instanceof Date ? observed.toISOString().slice(0, 10) :
          observed == null ? null : String(observed).slice(0, 10),
      },
      debts: {
        activeAccounts: String(debts[0].total ?? "0"),
        outstandingBalanceRand: String(debts[0].balance ?? "0"),
        inArrearsAccounts: String(debts[0].arrears ?? "0"),
      },
      policies: {
        activePolicies: String(policies[0].total ?? "0"),
        monthlyPremiumRand: String(policies[0].premium ?? "0"),
        wastefulPolicies: String(policies[0].wasteful ?? "0"),
      },
      replicatedToPostgres: false,
    };
  } finally {
    try { await connection.query("ROLLBACK"); }
    finally { await connection.end(); }
  }
}
