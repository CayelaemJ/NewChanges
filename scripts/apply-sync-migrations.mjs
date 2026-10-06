// Applies src/migrations/00X-*.sql (server-side procedures for live SQL
// sync) to the portal database. Safe to re-run: every statement is
// CREATE OR REPLACE.
//
// Usage:  node scripts/apply-sync-migrations.mjs
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dirCandidates = [join(root, "src", "Migrations"), join(root, "src", "migrations")];
const dir = dirCandidates.find((candidate) => existsSync(candidate));
if (!dir) {
  console.error(`Sync migration directory not found. Checked: ${dirCandidates.join(", ")}`);
  process.exit(1);
}
const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }

// Split a .sql file into executable statements, honouring PL/pgSQL
// $$...$$ dollar quoting and '...' string literals so the semicolons
// inside function bodies never split mid-statement.
function splitSql(sql) {
  const out = [];
  let cur = "", i = 0, dollarTag = null, inSingle = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (dollarTag) {
      if (sql.startsWith(dollarTag, i)) { cur += dollarTag; i += dollarTag.length; dollarTag = null; continue; }
      cur += ch; i++; continue;
    }
    if (inSingle) {
      cur += ch;
      if (ch === "'" && sql[i + 1] === "'") { cur += "'"; i += 2; continue; }
      if (ch === "'") inSingle = false;
      i++; continue;
    }
    const m = sql.slice(i).match(/^(?:\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/);
    if (m) { dollarTag = m[0]; cur += dollarTag; i += dollarTag.length; continue; }
    if (ch === "-" && sql[i + 1] === "-") {
      const e = sql.indexOf("\n", i);
      cur += sql.slice(i, e < 0 ? sql.length : e);
      i = e < 0 ? sql.length : e;
      continue;
    }
    if (ch === "'") { inSingle = true; cur += ch; i++; continue; }
    if (ch === ";") { out.push(cur.trim()); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.filter((s) => s.length > 0 && s.split(/\r?\n/).some((l) => l.trim() && !l.trim().startsWith('--')));
}

const client = new pg.Client({ connectionString: url });
await client.connect();

const requested = process.argv.slice(2).filter(Boolean);
const available = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const files = requested.length ? requested : available;
for (const file of files) {
  if (!available.includes(file)) {
    console.error(`Unknown sync migration "${file}". Available: ${available.join(", ")}`);
    process.exit(1);
  }
}
for (const file of files) {
  const statements = splitSql(readFileSync(join(dir, file), "utf8"));
  for (const stmt of statements) await client.query(stmt);
  console.log(`OK ${file} - ${statements.length} statement(s) applied`);
}

if (files.includes("001-sync-upsert-procedures.sql")) {
  const bulkFunctions = [
    "sync_upsert_employers",
    "sync_upsert_workforce_snapshots",
    "sync_upsert_employees",
    "sync_upsert_platform_users",
    "sync_upsert_journeys",
    "sync_upsert_debt_accounts",
    "sync_upsert_policies",
    "sync_upsert_ratings",
    "sync_upsert_referrals",
    "sync_upsert_salary_advances",
  ];
  for (const fn of bulkFunctions) {
    const result = await client.query(`SELECT inserted, updated, deleted FROM ${fn}('[]'::jsonb)`);
    const row = result.rows?.[0] ?? {};
    if (Number(row.inserted ?? 0) !== 0 || Number(row.updated ?? 0) !== 0 || Number(row.deleted ?? 0) !== 0) {
      throw new Error(`Bulk sync smoke test for ${fn} unexpectedly changed rows`);
    }
    console.log(`SMOKE OK ${fn} (empty batch)`);
  }

  // Transactional semantic smoke test. The dated feeds intentionally contain
  // multiple observations for the same current projection key. This catches
  // PostgreSQL 21000 ("ON CONFLICT ... cannot affect row a second time") and
  // verifies that history keeps every observation while the projection keeps
  // only the newest one. Everything is rolled back.
  const suffix = `${process.pid}-${Date.now()}`;
  const employer = `__EFS_SMOKE_EMP_${suffix}`;
  const payroll = `__EFS_SMOKE_PAY_${suffix}`;
  const journey = `__EFS_SMOKE_JNY_${suffix}`;
  const account = `__EFS_SMOKE_ACC_${suffix}`;
  const policy = `__EFS_SMOKE_POL_${suffix}`;
  const rating = `__EFS_SMOKE_RTG_${suffix}`;
  const referral = `__EFS_SMOKE_REF_${suffix}`;
  const advance = `__EFS_SMOKE_EWA_${suffix}`;
  const t1 = "2026-01-10T08:00:00Z";
  const t2 = "2026-02-10T08:00:00Z";

  const call = async (fn, rows) => {
    const result = await client.query(
      `SELECT inserted, updated, deleted FROM ${fn}($1::jsonb)`,
      [JSON.stringify(rows)],
    );
    console.log(`SMOKE OK ${fn} (${rows.length} canonical row(s))`);
    return result.rows?.[0] ?? {};
  };

  await client.query("BEGIN");
  try {
    await call("sync_upsert_employers", [{
      employer_ref: employer, name: "Bulk Sync Smoke Employer",
      eligible_count: 2, eligible_count_as_at: "2026-02-28",
      source_updated_at: t2, is_deleted: false,
    }]);
    await call("sync_upsert_workforce_snapshots", [
      { employer_ref: employer, as_of_date: "2026-01-31", eligible_count: 1, source_updated_at: t1, is_deleted: false },
      { employer_ref: employer, as_of_date: "2026-02-28", eligible_count: 2, source_updated_at: t2, is_deleted: false },
    ]);
    await call("sync_upsert_employees", [
      {
        employer_ref: employer, payroll_ref: payroll, observed_at: "2026-01-31",
        site_name: "Smoke Site A", income_band: "BAND_10_20K",
        eligible_from: "2026-01-01", eligible_to: null, active: true,
        source_updated_at: t1, is_deleted: false,
      },
      {
        employer_ref: employer, payroll_ref: payroll, observed_at: "2026-02-28",
        site_name: "Smoke Site B", income_band: "BAND_20_40K",
        eligible_from: "2026-01-01", eligible_to: null, active: true,
        source_updated_at: t2, is_deleted: false,
      },
    ]);
    const employeeState = await client.query(
      `SELECT "id",to_char("observedAt",'YYYY-MM-DD') AS "observedDate","incomeBand"::text AS "incomeBand" FROM "Employee" WHERE "employerId"=$1 AND "payrollRef"=$2`,
      [employer, payroll],
    );
    const employeeId = employeeState.rows?.[0]?.id;
    if (!employeeId || employeeState.rows[0].observedDate !== "2026-02-28" || employeeState.rows[0].incomeBand !== "BAND_20_40K") {
      throw new Error("Employee bulk projection did not retain the newest dated observation");
    }
    const employeeHistory = await client.query(`SELECT COUNT(*)::int AS n FROM "EmployeeVersion" WHERE "employeeId"=$1`, [employeeId]);
    if (Number(employeeHistory.rows?.[0]?.n ?? 0) !== 2) throw new Error("Employee bulk history did not retain both observations");

    await call("sync_upsert_platform_users", [{
      employer_ref: employer, payroll_ref: payroll, enrolled_at: "2026-01-15",
      activated_at: "2026-01-20", has_credit_profile: true,
      source_updated_at: t2, is_deleted: false,
    }]);
    await call("sync_upsert_journeys", [{
      journey_ref: journey, employer_ref: employer, payroll_ref: payroll,
      type: "ARREARS", status: "COMPLETED", started_at: "2026-01-20", completed_at: "2026-02-05",
      monthly_saving_rand: 12500, balance_impact_rand: 500000,
      source_updated_at: t2, is_deleted: false,
    }]);

    await call("sync_upsert_debt_accounts", [
      {
        account_ref: account, employer_ref: employer, payroll_ref: payroll, observed_at: "2026-01-31",
        closed_at: null, creditor_name: "Smoke Creditor", credit_type: "BANK_LOAN",
        balance_rand: 750000, in_arrears: true, state: "ACTIVE_INTERVENTION",
        challenge_status: null, journey_ref: journey, source_updated_at: t1, is_deleted: false,
      },
      {
        account_ref: account, employer_ref: employer, payroll_ref: payroll, observed_at: "2026-02-28",
        closed_at: null, creditor_name: "Smoke Creditor", credit_type: "BANK_LOAN",
        balance_rand: 700000, in_arrears: false, state: "NONE",
        challenge_status: null, journey_ref: journey, source_updated_at: t2, is_deleted: false,
      },
    ]);
    const debtState = await client.query(`SELECT to_char("observedAt",'YYYY-MM-DD') AS "observedDate","balanceCents" FROM "DebtAccount" WHERE "id"=$1`, [account]);
    if (debtState.rows?.[0]?.observedDate !== "2026-02-28" || Number(debtState.rows?.[0]?.balanceCents) !== 700000) {
      throw new Error("Debt bulk projection did not retain the newest dated observation");
    }
    const debtHistory = await client.query(`SELECT COUNT(*)::int AS n FROM "DebtAccountVersion" WHERE "accountId"=$1`, [account]);
    if (Number(debtHistory.rows?.[0]?.n ?? 0) !== 2) throw new Error("Debt bulk history did not retain both observations");

    await call("sync_upsert_policies", [
      {
        policy_ref: policy, employer_ref: employer, payroll_ref: payroll, observed_at: "2026-01-31",
        effective_from: "2025-01-01", effective_to: null, resolved_at: null,
        type: "FUNERAL", premium_rand: 25000, is_wasteful: true, is_resolved: false,
        source_updated_at: t1, is_deleted: false,
      },
      {
        policy_ref: policy, employer_ref: employer, payroll_ref: payroll, observed_at: "2026-02-28",
        effective_from: "2025-01-01", effective_to: null, resolved_at: "2026-02-20",
        type: "FUNERAL", premium_rand: 20000, is_wasteful: false, is_resolved: true,
        source_updated_at: t2, is_deleted: false,
      },
    ]);
    const policyState = await client.query(`SELECT to_char("observedAt",'YYYY-MM-DD') AS "observedDate","premiumCents" FROM "InsurancePolicy" WHERE "id"=$1`, [policy]);
    if (policyState.rows?.[0]?.observedDate !== "2026-02-28" || Number(policyState.rows?.[0]?.premiumCents) !== 20000) {
      throw new Error("Policy bulk projection did not retain the newest dated observation");
    }
    const policyHistory = await client.query(`SELECT COUNT(*)::int AS n FROM "InsurancePolicyVersion" WHERE "policyId"=$1`, [policy]);
    if (Number(policyHistory.rows?.[0]?.n ?? 0) !== 2) throw new Error("Policy bulk history did not retain both observations");

    await call("sync_upsert_ratings", [{
      rating_ref: rating, employer_ref: employer, payroll_ref: payroll,
      journey_type: "ARREARS", stars: 5, created_at: "2026-02-10",
      source_updated_at: t2, is_deleted: false,
    }]);
    await call("sync_upsert_referrals", [{
      referral_ref: referral, employer_ref: employer, payroll_ref: payroll,
      channel: "WhatsApp", shared_at: "2026-02-11", converted: true, converted_at: "2026-02-12",
      source_updated_at: t2, is_deleted: false,
    }]);
    await call("sync_upsert_salary_advances", [{
      salary_advance_id: advance, employer_ref: employer, client_id: `CLIENT-${suffix}`, payroll_ref: payroll,
      amount: 150000, salary_advance_status: "FINALISED",
      bank_account_verification_status: "PASSED", blacklisted: false, advanced_at: "2026-02-15",
      source_updated_at: t2, is_deleted: false,
    }]);

    await client.query("ROLLBACK");
    console.log("SMOKE OK dated multi-observation projection/history semantics (rolled back)");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

await client.end();
console.log("All sync migrations applied and bulk procedures smoke-tested.");
