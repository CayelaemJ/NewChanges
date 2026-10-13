// Read-only verification of two PostgreSQL application databases.
// Usage: DR_SOURCE_DATABASE_URL=... DR_TARGET_DATABASE_URL=... node scripts/check-postgres-dr.mjs
// This does not configure ingestion sources, copy data, or promote a standby.
import pg from "pg";

const { Client } = pg;
const sourceUrl = process.env.DR_SOURCE_DATABASE_URL;
const targetUrl = process.env.DR_TARGET_DATABASE_URL;
if (!sourceUrl || !targetUrl) {
  console.error("Both DR_SOURCE_DATABASE_URL and DR_TARGET_DATABASE_URL are required.");
  process.exit(2);
}
function identity(urlString) {
  const url = new URL(urlString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Only PostgreSQL URLs are allowed");
  return `${url.hostname}:${url.port || 5432}/${url.pathname.slice(1)}`;
}
if (identity(sourceUrl) === identity(targetUrl)) {
  console.error("Source and target refer to the same PostgreSQL database; refusing misleading DR comparison.");
  process.exit(2);
}
async function inspect(connectionString) {
  const client = new Client({ connectionString, connectionTimeoutMillis: 10000, query_timeout: 10000 });
  await client.connect();
  try {
    await client.query("BEGIN READ ONLY");
    const version = await client.query("SHOW server_version");
    const writable = await client.query("SELECT pg_is_in_recovery() AS is_replica, current_database() AS database_name");
    const tables = await client.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name"
    );
    const tableNames = tables.rows.map((r) => r.table_name);
    const sampleCounts = {};
    for (const table of ["User", "Employer", "Session", "DashboardCohortCache", "IntegrationCursor"]) {
      if (!tableNames.includes(table)) continue;
      const quoted = '"' + table.replaceAll('"', '""') + '"';
      const count = await client.query(`SELECT count(*)::text AS value FROM public.${quoted}`);
      sampleCounts[table] = count.rows[0].value;
    }
    await client.query("COMMIT");
    return { version: version.rows[0].server_version, ...writable.rows[0], tableCount: tableNames.length, sampleCounts };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}
try {
  const [source, target] = await Promise.all([inspect(sourceUrl), inspect(targetUrl)]);
  console.log(JSON.stringify({
    source: { endpoint: identity(sourceUrl), ...source },
    target: { endpoint: identity(targetUrl), ...target },
    warning: "Row counts do not prove a consistent replica. Validate schema, write fencing, recovery point and session continuity before traffic failover."
  }, null, 2));
} catch (error) {
  console.error("DR inspection failed:", error?.message || String(error));
  process.exitCode = 1;
}
