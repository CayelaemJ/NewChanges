/**
 * Zero-replication, tenant-scoped MySQL dashboard preview.
 *
 * All four event KPI queries run in ONE read-only transaction to avoid
 * different-connection snapshots and reduce connection churn. No Prisma,
 * import cursor, source-row upserts or PostgreSQL projections are touched.
 *
 * Preview only: historical as-at balances, cohorts and scoring parity are
 * deliberately NOT claimed to be implemented here.
 */
import type { IntegrationSourceConfig } from "./sourceAdapter.js";
import { effectiveSourceConfig } from "./sourceAdapter.js";
import { directReportingEnabled } from "./directMysqlReporting.js";

const ID = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DAY_MS = 86_400_000;
const TIMEOUT_MS = 10_000;

export interface DirectDashboardPreviewInput {
  employerRef: string;
  startDate: string; // inclusive ISO calendar date
  endDate: string; // exclusive ISO calendar date
}

export interface DirectDashboardPreview {
  source: "MYSQL";
  mode: "DIRECT_PREVIEW";
  employerRef: string;
  window: { startInclusive: string; endExclusive: string };
  journeys: {
    started: string;
    completedOfStarted: string;
    completedStartedMonthlySavingsRand: string;
  };
  ratings: { submitted: string; fiveStar: string };
  referrals: { shared: string; convertedAmongShared: string };
  salaryAdvances: {
    requested: string;
    finalised: string;
    finalisedAmountRand: string;
  };
  replicatedToPostgres: false;
}

function identifier(value: string): string {
  if (!ID.test(value)) throw new Error("Invalid reporting identifier");
  return "`" + value + "`";
}
function isoDay(raw: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return false;
  const date = new Date(raw + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw;
}
function checkInput(input: DirectDashboardPreviewInput): void {
  if (!input.employerRef || input.employerRef.length > 128)
    throw new Error("Valid employer scope required");
  if (!isoDay(input.startDate) || !isoDay(input.endDate) || input.startDate >= input.endDate)
    throw new Error("Invalid date window");
  if (Date.parse(input.endDate) - Date.parse(input.startDate) > 366 * DAY_MS)
    throw new Error("Date window exceeds one year");
}

export async function readDirectDashboardPreview(
  config: IntegrationSourceConfig,
  input: DirectDashboardPreviewInput,
): Promise<DirectDashboardPreview> {
  if (!directReportingEnabled()) throw new Error("Direct reporting is disabled");
  checkInput(input);
  const source = effectiveSourceConfig(config);
  if (String(source.sourceMode ?? "").toUpperCase() !== "SQL" ||
      String(source.sqlDialect ?? "").toUpperCase() !== "MYSQL" ||
      source.sqlSsl !== true || source.sqlTrustServerCertificate === true)
    throw new Error("A verified-TLS MySQL reporting source is required");
  if (!source.sqlHost || !/^[A-Za-z0-9.-]{1,253}$/.test(source.sqlHost) ||
      !source.sqlDatabase || !source.sqlUsername || !source.sqlPassword)
    throw new Error("MySQL reporting source is not fully configured");
  const port = Number(source.sqlPort ?? 3306);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid MySQL port");
  const view = (key: string) =>
    identifier(source.sqlDatabase!) + "." + identifier((source.sqlViewPrefix ?? "v_") + key);
  // SQL fragments contain no user-controlled identifiers or expressions.
  const statements = {
    journeys: `SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END),0) AS secondary,
      COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN monthly_saving_rand ELSE 0 END),0) AS amount
      FROM ${view("journeys")}
      WHERE employer_ref = ? AND started_at >= ? AND started_at < ?`,
    ratings: `SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN stars = 5 THEN 1 ELSE 0 END),0) AS secondary, NULL AS amount
      FROM ${view("ratings")}
      WHERE employer_ref = ? AND created_at >= ? AND created_at < ?`,
    referrals: `SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN converted = 1 THEN 1 ELSE 0 END),0) AS secondary, NULL AS amount
      FROM ${view("referrals")}
      WHERE employer_ref = ? AND shared_at >= ? AND shared_at < ?`,
    salaryAdvances: `SELECT COUNT(*) AS total,
      COALESCE(SUM(CASE WHEN salary_advance_status = 'FINALISED' THEN 1 ELSE 0 END),0) AS secondary,
      COALESCE(SUM(CASE WHEN salary_advance_status = 'FINALISED' THEN amount ELSE 0 END),0) AS amount
      FROM ${view("salary_advances")}
      WHERE employer_ref = ? AND advanced_at >= ? AND advanced_at < ?`,
  };
  const mysql = await import("mysql2/promise");
  const connection = await mysql.createConnection({
    host: source.sqlHost, port, database: source.sqlDatabase,
    user: source.sqlUsername, password: source.sqlPassword,
    ssl: { rejectUnauthorized: true }, connectTimeout: TIMEOUT_MS,
    timezone: "Z", supportBigNumbers: true, bigNumberStrings: true,
    multipleStatements: false,
  });
  try {
    await connection.query("SET TRANSACTION READ ONLY");
    await connection.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    const params = [input.employerRef, input.startDate, input.endDate];
    async function execute(sql: string) {
      const [rows] = await connection.query({ sql, timeout: TIMEOUT_MS }, params);
      const result = (rows as Record<string, unknown>[])[0];
      if (!result) throw new Error("A MySQL reporting view returned no aggregate");
      return {
        total: String(result.total ?? "0"),
        secondary: String(result.secondary ?? "0"),
        amount: String(result.amount ?? "0"),
      };
    }
    const journeys = await execute(statements.journeys);
    const ratings = await execute(statements.ratings);
    const referrals = await execute(statements.referrals);
    const advances = await execute(statements.salaryAdvances);
    return {
      source: "MYSQL", mode: "DIRECT_PREVIEW", employerRef: input.employerRef,
      window: { startInclusive: input.startDate, endExclusive: input.endDate },
      journeys: {
        started: journeys.total,
        completedOfStarted: journeys.secondary,
        completedStartedMonthlySavingsRand: journeys.amount,
      },
      ratings: { submitted: ratings.total, fiveStar: ratings.secondary },
      referrals: { shared: referrals.total, convertedAmongShared: referrals.secondary },
      salaryAdvances: {
        requested: advances.total, finalised: advances.secondary,
        finalisedAmountRand: advances.amount,
      },
      replicatedToPostgres: false,
    };
  } finally {
    try { await connection.query("ROLLBACK"); }
    finally { await connection.end(); }
  }
}
