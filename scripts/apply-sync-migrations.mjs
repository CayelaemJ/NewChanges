// Applies src/migrations/00X-*.sql (server-side procedures for live SQL
// sync) to the portal database. Safe to re-run: every statement is
// CREATE OR REPLACE.
//
// Usage:  node scripts/apply-sync-migrations.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "src", "migrations");
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
    const m = sql.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*\$|\$\$/);
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

const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
for (const file of files) {
  const statements = splitSql(readFileSync(join(dir, file), "utf8"));
  for (const stmt of statements) await client.query(stmt);
  console.log(`OK ${file} - ${statements.length} statement(s) applied`);
}

await client.end();
console.log("All sync migrations applied.");
