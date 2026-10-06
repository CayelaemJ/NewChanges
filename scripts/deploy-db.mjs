import { spawnSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const prisma = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
const resetRequested = ["1", "true", "yes"].includes(String(process.env.PRELIVE_RESET_DATABASE ?? "").toLowerCase());

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

console.log("Applying non-destructive Prisma schema sync...");
// Prisma db push intentionally refuses enum renames because they look destructive.
// Apply the role rename explicitly first, so existing users keep their role data.
const roleMigration = run(["db", "execute", "--file", "prisma/migrations/20261002120000_redesign_user_roles/migration.sql"]);
if (roleMigration !== 0) {
  console.error("Role migration failed. No database reset was attempted.");
  process.exit(roleMigration);
}
const status = run(["db", "push", "--skip-generate"]);
if (status !== 0) {
  console.error("Database schema sync failed. Because destructive fallback is disabled, no reset was attempted.");
  console.error("For a disposable pre-live database only, set PRELIVE_RESET_DATABASE=true and PRELIVE_RESET_CONFIRM=DELETE_PRELIVE_DATA for one deployment, then remove both variables.");
  process.exit(status);
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
// These are CREATE OR REPLACE functions and are the normal fast path for API/SQL
// integration syncs. Without them the app falls back to the much slower 1k-row
// Prisma commit path, which is not acceptable for 100k+ row source tables.
console.log("\n🧩 Applying core bulk sync procedures...");
const coreSync = spawnSync("node", ["scripts/apply-sync-migrations.mjs", "001-sync-upsert-procedures.sql"], { stdio: "inherit" });
if (coreSync.error || coreSync.status !== 0) {
  console.error("Core bulk sync procedure installation failed; refusing to deploy the slow fallback as the default.");
  if (coreSync.error) console.error(coreSync.error);
  process.exit(coreSync.status ?? 1);
}

// Optional legacy/direct helpers remain opt-in. The application does not depend
// on these for the normal cross-database sync path.
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
