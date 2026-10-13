// Identity-only migration between two PostgreSQL application databases.
// Dry-run by default. Use --apply only after a destination schema has been
// deployed and the source has been placed into an approved maintenance window.
// This script NEVER modifies the source and NEVER clears existing target data.
import pg from "pg";

const { Client } = pg;
const TABLES = [
  "Partner", "Employer", "DashboardSection", "User",
  "UserEmployer", "UserSectionAccess",
];
const includeSessions = process.argv.includes("--include-sessions");
if (includeSessions) TABLES.push("Session");
const apply = process.argv.includes("--apply");
const sourceUrl = process.env.DR_SOURCE_DATABASE_URL;
const targetUrl = process.env.DR_TARGET_DATABASE_URL;
if (!sourceUrl || !targetUrl) {
  console.error("Set DR_SOURCE_DATABASE_URL and DR_TARGET_DATABASE_URL. No database modified.");
  process.exit(2);
}
function identity(connectionString) {
  const url = new URL(connectionString);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("Only PostgreSQL application databases are supported");
  return [url.hostname.toLowerCase(), url.port || "5432", decodeURIComponent(url.pathname)];
}
const sourceId = identity(sourceUrl), targetId = identity(targetUrl);
if (JSON.stringify(sourceId) === JSON.stringify(targetId)) {
  throw new Error("Source and destination resolve to the same PostgreSQL endpoint");
}
const quoted = (s) => '"' + s.replaceAll('"', '""') + '"';
async function columns(client, table) {
  const r = await client.query(
    `SELECT column_name, data_type, udt_name, is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position`,
    [table]
  );
  return r.rows;
}
async function main() {
  const src = new Client({ connectionString: sourceUrl, connectionTimeoutMillis: 10000 });
  const dst = new Client({ connectionString: targetUrl, connectionTimeoutMillis: 10000 });
  let srcTx = false, dstTx = false;
  try {
    await src.connect();
    await dst.connect();
    await src.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    srcTx = true;
    await dst.query("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE");
    dstTx = true;
    // Avoid concurrent migrations or admins writing to the destination.
    // An exclusive lock is transaction-scoped and released on commit/rollback.
    for (const table of TABLES) {
      const srcColumns = await columns(src, table);
      const dstColumns = await columns(dst, table);
      if (!srcColumns.length || !dstColumns.length ||
          JSON.stringify(srcColumns) !== JSON.stringify(dstColumns)) {
        throw new Error(`Schema mismatch for ${table}; prepare an identical destination schema first`);
      }
    }
    for (const table of TABLES) {
      await dst.query(`LOCK TABLE public.${quoted(table)} IN ACCESS EXCLUSIVE MODE`);
      const count = await dst.query(`SELECT count(*)::int AS total FROM public.${quoted(table)}`);
      if (count.rows[0].total !== 0) throw new Error(`Destination ${table} is not empty; refusing to overwrite data`);
    }
    const results = {};
    for (const table of TABLES) {
      const names = (await columns(src, table)).map((c) => c.column_name);
      const data = await src.query(`SELECT * FROM public.${quoted(table)}`);
      results[table] = data.rowCount;
      if (apply && data.rows.length) {
        const columnsSQL = names.map(quoted).join(", ");
        // Insert in bounded batches to avoid parameter count limits.
        for (let offset = 0; offset < data.rows.length; offset += 100) {
          const batch = data.rows.slice(offset, offset + 100);
          const parameters = [];
          const placeholders = batch.map((row) =>
            "(" + names.map((name) => {
              parameters.push(row[name]);
              return "$" + parameters.length;
            }).join(",") + ")"
          );
          await dst.query(
            `INSERT INTO public.${quoted(table)} (${columnsSQL}) VALUES ${placeholders.join(",")}`,
            parameters
          );
        }
        const actual = await dst.query(`SELECT count(*)::int AS total FROM public.${quoted(table)}`);
        if (actual.rows[0].total !== data.rowCount) throw new Error(`Count mismatch after copying ${table}`);
      }
    }
    if (apply) {
      await dst.query("COMMIT");
      dstTx = false;
    } else {
      await dst.query("ROLLBACK");
      dstTx = false;
    }
    console.log(JSON.stringify({
      mode: apply ? "applied" : "dry-run (no changes)",
      tables: results,
      sessionsIncluded: includeSessions,
      note: "Validate password login, user permissions, partner themes and employer access before traffic cutover. Source was not modified."
    }, null, 2));
  } finally {
    if (dstTx) await dst.query("ROLLBACK").catch(() => {});
    if (srcTx) await src.query("ROLLBACK").catch(() => {});
    await Promise.allSettled([src.end(), dst.end()]);
  }
}
main().catch((error) => {
  console.error("Identity migration aborted without a completed copy:", error?.message || String(error));
  process.exitCode = 1;
});
