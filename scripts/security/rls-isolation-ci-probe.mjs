import assert from "node:assert/strict";
import pg from "pg";

/**
 * Disposable PostgreSQL-only RLS behaviour proof.
 * This does NOT migrate NewChanges tables or access production/business data.
 */
const url = new URL(process.env.DATABASE_URL ?? "postgresql://invalid/invalid");
assert.equal(process.env.CI_RLS_PROBE_APPROVED, "CI_DISPOSABLE_ONLY",
  "Explicit disposable CI database approval required");
assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) &&
  url.pathname === "/newchanges_ci" && url.username === "ci_fixture",
  "RLS test refuses non-local or non-CI databases");

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 7000,
  query_timeout: 15000,
  statement_timeout: 15000,
  application_name: "newchanges-disposable-rls-probe",
});
let begun = false;
try {
  await client.connect();
  await client.query("BEGIN");
  begun = true;

  // All schema/role changes are intentionally contained in this transaction,
  // and always rolled back. No existing tables are modified.
  await client.query('CREATE SCHEMA "_rls_probe"');
  await client.query('CREATE ROLE newchanges_rls_probe NOLOGIN NOBYPASSRLS');
  await client.query('CREATE TABLE "_rls_probe"."employers" ("id" text PRIMARY KEY)');
  await client.query('CREATE TABLE "_rls_probe"."employees" ("id" text PRIMARY KEY, "employer_id" text NOT NULL REFERENCES "_rls_probe"."employers" ("id"))');

  await client.query('INSERT INTO "_rls_probe"."employers" ("id") VALUES (\'employer-a\'), (\'employer-b\')');
  await client.query('INSERT INTO "_rls_probe"."employees" ("id","employer_id") VALUES (\'person-a\',\'employer-a\'), (\'person-b\',\'employer-b\')');

  await client.query('ALTER TABLE "_rls_probe"."employers" ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE "_rls_probe"."employers" FORCE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE "_rls_probe"."employees" ENABLE ROW LEVEL SECURITY');
  await client.query('ALTER TABLE "_rls_probe"."employees" FORCE ROW LEVEL SECURITY');
  await client.query(`CREATE POLICY "tenant_employers" ON "_rls_probe"."employers"
    FOR ALL TO newchanges_rls_probe
    USING ("id" = NULLIF(current_setting('app.current_employer_id', true), ''))
    WITH CHECK ("id" = NULLIF(current_setting('app.current_employer_id', true), ''))`);
  await client.query(`CREATE POLICY "tenant_employees" ON "_rls_probe"."employees"
    FOR ALL TO newchanges_rls_probe
    USING ("employer_id" = NULLIF(current_setting('app.current_employer_id', true), ''))
    WITH CHECK ("employer_id" = NULLIF(current_setting('app.current_employer_id', true), ''))`);

  await client.query('GRANT USAGE ON SCHEMA "_rls_probe" TO newchanges_rls_probe');
  await client.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "_rls_probe" TO newchanges_rls_probe');
  await client.query("SET LOCAL ROLE newchanges_rls_probe");

  const role = await client.query("SELECT current_user, rolbypassrls FROM pg_roles WHERE rolname=current_user");
  assert.equal(role.rows[0].current_user, "newchanges_rls_probe");
  assert.equal(role.rows[0].rolbypassrls, false);

  const employeeIds = async () =>
    (await client.query('SELECT "id" FROM "_rls_probe"."employees" ORDER BY "id"')).rows.map(row => row.id);

  // No server-validated tenant context = no records.
  assert.deepEqual(await employeeIds(), []);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM "_rls_probe"."employers"')).rows[0].n, 0);

  await client.query("SELECT set_config('app.current_employer_id', $1, true)", ["employer-a"]);
  assert.deepEqual(await employeeIds(), ["person-a"]);
  assert.equal((await client.query('SELECT count(*)::int AS n FROM "_rls_probe"."employers"')).rows[0].n, 1);

  // Cross-tenant reads, updates and deletes must not touch employer B.
  assert.equal((await client.query('UPDATE "_rls_probe"."employees" SET "id" = $1 WHERE "id" = $2', ["changed-b", "person-b"])).rowCount, 0);
  assert.equal((await client.query('DELETE FROM "_rls_probe"."employees" WHERE "id" = $1', ["person-b"])).rowCount, 0);

  await client.query("SAVEPOINT cross_tenant_insert");
  await assert.rejects(
    client.query('INSERT INTO "_rls_probe"."employees" ("id","employer_id") VALUES ($1,$2)', ["illegal", "employer-b"]),
    error => error?.code === "42501",
  );
  await client.query("ROLLBACK TO SAVEPOINT cross_tenant_insert");

  await client.query("SAVEPOINT cross_tenant_update");
  await assert.rejects(
    client.query('UPDATE "_rls_probe"."employees" SET "employer_id"=$1 WHERE "id"=$2', ["employer-b", "person-a"]),
    error => error?.code === "42501",
  );
  await client.query("ROLLBACK TO SAVEPOINT cross_tenant_update");

  // Simulate *trusted* server establishing a different tenant context in this
  // same disposable transaction. Never accept the context from request input.
  await client.query("SELECT set_config('app.current_employer_id', $1, true)", ["employer-b"]);
  assert.deepEqual(await employeeIds(), ["person-b"]);
  console.log("[rls-pilot] Missing context, tenant separation and cross-tenant writes denied.");
} finally {
  if (begun) {
    await client.query("RESET ROLE").catch(() => {});
    await client.query("ROLLBACK").catch(() => {});
  }
  await client.end().catch(() => {});
}
