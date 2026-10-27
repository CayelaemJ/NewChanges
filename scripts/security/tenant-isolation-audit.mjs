import pg from "pg";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const { Client } = pg;
const SCOPING_COLUMNS = new Set(["employerId", "employeeId", "platformUserId", "userId", "partnerId"]);

export function assessTenantIsolation(tables, runtimeRole) {
  const scoped = tables.filter(row =>
    Array.isArray(row.scope_columns) && row.scope_columns.some(column => SCOPING_COLUMNS.has(column)));
  const unprotected = scoped.filter(row => !row.rls_enabled).map(row => row.table_name).sort();
  const notForced = scoped.filter(row => row.rls_enabled && !row.rls_forced).map(row => row.table_name).sort();
  const withoutPolicies = scoped.filter(row => row.rls_enabled && Number(row.policy_count ?? 0) === 0).map(row => row.table_name).sort();
  return {
    publicTables: tables.length,
    rlsEnabled: tables.filter(row => row.rls_enabled).length,
    rlsForced: tables.filter(row => row.rls_forced).length,
    candidateScopedTables: scoped.length,
    candidateScopedWithoutRls: unprotected,
    candidateScopedNotForced: notForced,
    candidateScopedWithoutPolicies: withoutPolicies,
    runtimeRoleBypassesRls: runtimeRole?.rolbypassrls === true,
    // Catalog preflight only: policies still require an access-control review and cross-tenant tests.
    catalogPreflightPassed: tables.length > 0 && scoped.length > 0 && unprotected.length === 0 &&
      withoutPolicies.length === 0 && runtimeRole?.rolbypassrls === false,
  };
}

async function main() {
  if (process.env.TENANT_AUDIT_READ_ONLY !== "YES" || !process.env.DATABASE_URL) {
    console.error("[tenant-isolation] Set TENANT_AUDIT_READ_ONLY=YES and DATABASE_URL explicitly.");
    process.exitCode = 2;
    return;
  }
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 7000,
    query_timeout: 15000,
    statement_timeout: 15000,
    application_name: "newchanges-readonly-tenant-isolation-audit",
  });
  try {
    await client.connect();
    await client.query("BEGIN READ ONLY");
    const role = await client.query(
      "SELECT current_user AS role_name, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    const tables = await client.query(`
      SELECT c.relname::text AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             (SELECT COUNT(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname)::int AS policy_count,
             COALESCE(array_agg(a.attname ORDER BY a.attname)
               FILTER (WHERE a.attname IN ('employerId', 'employeeId', 'platformUserId', 'userId', 'partnerId')),
               ARRAY[]::name[])::text[] AS scope_columns
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      LEFT JOIN pg_attribute a ON a.attrelid = c.oid
        AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
      GROUP BY c.relname, c.relrowsecurity, c.relforcerowsecurity
      ORDER BY c.relname
    `);
    await client.query("ROLLBACK");
    const result = assessTenantIsolation(tables.rows, role.rows[0]);
    // Metadata only: no credentials, user records, rows, or connection identifiers.
    console.log(JSON.stringify(result, null, 2));
    if (!result.catalogPreflightPassed) process.exitCode = 1;
  } catch {
    console.error("[tenant-isolation] Audit could not complete; review DB connectivity/permissions.");
    process.exitCode = 2;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main();
}
