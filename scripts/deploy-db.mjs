import { spawnSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";
import { Client } from "pg";

const prisma = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
const resetRequested = ["1", "true", "yes"].includes(String(process.env.PRELIVE_RESET_DATABASE ?? "").toLowerCase());
// "migrate" (default) uses the versioned migration history. "push" keeps the
// previous db push behaviour as a documented escape hatch if a migration-based
// deploy needs to be backed out in a hurry.
const mode = String(process.env.DB_DEPLOY_MODE ?? "migrate").toLowerCase();
const BASELINE = "00000000000000_baseline";

function run(args) {
  const env = {
    ...process.env,
    PRISMA_HIDE_UPDATE_MESSAGE: process.env.PRISMA_HIDE_UPDATE_MESSAGE ?? "1",
  };
  const result = spawnSync(prisma, args, { stdio: "inherit", env });
  if (result.error) {
    console.error(result.error);
    return 1;
  }
  return result.status ?? 1;
}

// A database that was previously managed with `prisma db push` has the schema
// but no `_prisma_migrations` history. Mark the baseline as already applied so
// `migrate deploy` does not try to re-create existing tables.
async function baselineIfNeeded() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return;
  const client = new Client({ connectionString });
  try {
    await client.connect();
  } catch (error) {
    console.warn("Could not connect to inspect migration history; continuing.", error?.message ?? error);
    return;
  }
  try {
    const hist = await client.query(`SELECT to_regclass('"_prisma_migrations"') AS t`);
    let applied = 0;
    if (hist.rows[0].t) {
      const n = await client.query(`SELECT COUNT(*)::int AS n FROM "_prisma_migrations"`);
      applied = n.rows[0].n;
    }
    if (applied > 0) return;
    const app = await client.query(`SELECT to_regclass('"User"') AS t`);
    if (!app.rows[0].t) return; // empty database: migrate deploy creates everything
    console.log("Existing schema with no migration history detected: baselining before the first migrate deploy...");
    if (run(["migrate", "resolve", "--applied", BASELINE]) !== 0) {
      console.error("Baselining failed. No schema change was applied.");
      process.exit(1);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

console.log("Validating Prisma schema...");
if (run(["validate"]) !== 0) process.exit(1);

if (resetRequested) {
  if (process.env.PRELIVE_RESET_CONFIRM !== "DELETE_PRELIVE_DATA") {
    console.error("PRELIVE_RESET_DATABASE is enabled. Set PRELIVE_RESET_CONFIRM=DELETE_PRELIVE_DATA to confirm the one-time reset.");
    process.exit(1);
  }
  console.warn("PRE-LIVE RESET CONFIRMED: rebuilding the application database schema and deleting existing application data.");
  process.exit(run(["db", "push", "--force-reset", "--skip-generate"]));
}

if (mode === "push") {
  console.warn("DB_DEPLOY_MODE=push: applying non-destructive schema sync (prisma db push). Prefer the default migrate mode.");
  const status = run(["db", "push", "--skip-generate"]);
  if (status !== 0) {
    console.error("Database schema sync failed.");
    process.exit(status);
  }
} else {
  await baselineIfNeeded();
  console.log("Applying versioned migrations (prisma migrate deploy)...");
  const status = run(["migrate", "deploy"]);
  if (status !== 0) {
    console.error("Migration deploy failed.");
    console.error("If this database was previously managed with `prisma db push`, baseline it once first:");
    console.error("  npm run db:baseline");
    console.error("To fall back to the previous behaviour, set DB_DEPLOY_MODE=push.");
    process.exit(status);
  }
}

// ── Configure MySQL as live data sync source if credentials are available ──
if (process.env.MYSQLHOST && process.env.MYSQLUSER && process.env.MYSQLPASSWORD && process.env.MYSQLDATABASE) {
  console.log("\n📡 Configuring MySQL as live data sync source...");
  const syncStatus = spawnSync("node", ["scripts/configure-mysql-sync.mjs"], { stdio: "inherit" });
  if (syncStatus.status !== 0) {
    console.warn("⚠️  MySQL sync configuration skipped (credentials incomplete or connection failed)");
  }
}

// ── Apply the core server-side bulk upsert procedures on every deploy. ──
console.log("\n🧩 Applying core bulk sync procedures...");
const coreSync = spawnSync("node", ["scripts/apply-sync-migrations.mjs", "001-sync-upsert-procedures.sql"], { stdio: "inherit" });
if (coreSync.error || coreSync.status !== 0) {
  console.error("Core bulk sync procedure installation failed; refusing to deploy the slow fallback as the default.");
  if (coreSync.error) console.error(coreSync.error);
  process.exit(coreSync.status ?? 1);
}

if (process.env.APPLY_SYNC_MIGRATIONS === "true") {
  console.log("\n🧩 Applying optional direct/bulk sync helpers...");
  const optionalSync = spawnSync("node", ["scripts/apply-sync-migrations.mjs", "002-direct-sql-sync.sql", "003-bulk-replace-sync.sql"], { stdio: "inherit" });
  if (optionalSync.error || optionalSync.status !== 0) {
    console.error("Optional sync helper installation failed.");
    if (optionalSync.error) console.error(optionalSync.error);
    process.exit(optionalSync.status ?? 1);
  }
}

process.exit(0);
