# NewChanges independent PostgreSQL disaster recovery

## Scope
This plan changes **application PostgreSQL** only (`DATABASE_URL`). Do not move or alter the SQL ingestion connectors, their SQL Server / MySQL / API credentials, their cursor semantics or their source schemas.

## Recommended low-cost topology
- Keep *one writable application PostgreSQL primary* outside Railway (for example, an independently hosted managed PostgreSQL with reliable backups).
- Railway and Render connect to that same primary via `DATABASE_URL`. This removes the Railway Postgres instance as a single failure domain.
- Keep the standby's `STANDBY_MODE=true` until writer leadership and explicit API-level write fencing are implemented. Startup scheduler suppression alone does not prevent manual API writes.
- Store a separately restorable, encrypted off-site PostgreSQL backup. Backups are not an always-on replica.
- If the independent database fails, this layout cannot guarantee admin writes; a separately promoted replica plus controlled reconfiguration is required.

## Migration checklist (operator-controlled, planned maintenance)
1. Provision an external PostgreSQL server with TLS, documented retention and an accessible network endpoint for *both* Railway and Render. Verify POPIA cross-border processing requirements. Never commit the connection URL.
2. Stop new admin writes and scheduled ingestion (maintenance window); record a tested restore point. Ensure the source remains reachable throughout the migration.
3. Run a consistent, all-schemas PostgreSQL dump with appropriate client version, e.g. `pg_dump --format=custom --no-owner --no-acl --file=newchanges.pgcustom "$OLD_DATABASE_URL"`. Store dump securely and keep credentials out of shell history.
4. Restore into a freshly provisioned *empty* external database after independently verifying the target identity, e.g. `pg_restore --no-owner --no-acl --exit-on-error --dbname="$NEW_DATABASE_URL" newchanges.pgcustom`. **Never use --clean or --create against a populated target.** Review extensions, roles and procedural SQL needed by the app.
5. Compare row counts and schema fingerprints with `DR_SOURCE_DATABASE_URL="$OLD_DATABASE_URL" DR_TARGET_DATABASE_URL="$NEW_DATABASE_URL" node scripts/check-postgres-dr.mjs`. Also perform application login, employer-scoping and dashboard filtering tests.
6. Set Railway `DATABASE_URL` to the independent primary via the provider's secret manager. On the Render standby, set the same external primary `DATABASE_URL` only once write-fencing and auth controls have been reviewed. Review Render's free-tier cold start.
7. Deploy one controlled service at a time; test /health, sign-in, data refresh, permissions, cron leadership and report schedules. Confirm a single set of scheduled writers.
8. Keep the old Railway PostgreSQL database **unchanged** for a defined rollback window. Retire it only after backup restoration, observability and full failover tests succeed.

## Post-migration HA options
A second independently operated *read replica* is suitable for dashboards during an outage, but cannot support admin writes until promoted. PostgreSQL streaming/logical replication must be explicitly configured and monitored; it is **not** created by setting DATABASE_URL or by copying tables once. Promotion requires fencing the old primary and handling WAL/data lag to prevent split-brain writes.

Automatic DNS/routing failover is a **separate project**. A lightweight /health endpoint that returns HTTP 200 without checking DB connectivity does not prove a standby is operational.

## Free-tier constraints
No assumption is made that a free database provides guaranteed durability, low-lag replication, point-in-time recovery or regional failover. Render free PostgreSQL's limited lifetime makes it unsuitable as the production recovery database.
