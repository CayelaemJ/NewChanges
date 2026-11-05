# Cloudflare NewChanges → Aiven PostgreSQL production cutover

Status: **NOT CUT OVER**. The user selected Aiven as the intended production primary for the Cloudflare-hosted NewChanges application. Do not interpret this document or the code support as authorization to run the stale snapshot as the live primary.

## Verified 2026-11-05
- Existing Aiven free PostgreSQL 18 at `the-fixer-postgres-cay-bed7.b.aivencloud.com:26029/defaultdb`; keep free-tier and region stable.
- Earlier point-in-time copy: 57 application tables, 707 columns, 232 indexes, 520 constraints; `DataAccessEvent` row count continues to diverge from Neon.
- Cloudflare account currently has Pages project `newchanges-app` (no configured database variables), Workers `newchanges-cloudflare-preview` and `newchanges-api-canary` (no database secret bindings), and no configured Hyperdrive. No verified, production-connected NewChanges container exists in this account.
- Cloudflare container branch contains `Dockerfile.cloudflare`, `cloudflare/main-app/preflight.mjs` and `verify-database.mjs`; these support selecting Aiven with `NEWCHANGES_DATABASE_PROVIDER=aiven` and explicit `NEWCHANGES_AIVEN_PRODUCTION_APPROVED=YES`. **Do not set that approval for an unverified deployment.**
- The Aiven administrative user `avnadmin` is not eligible for application runtime use. Create a least-privilege non-owner runtime role with required application read/write privileges but no schema/database create privileges, and confirm it passes the preflight.

## Prerequisites before configuring the production database secret
1. Locate or deploy the actual *full application* Fastify/Prisma backend to Cloudflare Containers and verify its production URL and health. The existing Pages static project alone is not a backend replacement.
2. Freeze/fence Neon application writes and scheduled ingestion during the maintenance window. Existing point-in-time Aiven data is **not live replication**. Perform an approved, recoverable *fresh* final copy or verified incremental reconciliation; do not overwrite current Aiven data blindly. Aiven must match the final source checkpoint, including sessions, MFA, authorizations and data generated since the earlier snapshot.
3. Verify the required authentication provider model. Neon-managed `neon_auth` schemas are excluded from the portable public snapshot. If the application depends on them, implement a supported equivalent before cutover.
4. Verify Aiven storage and WAL headroom for the final synchronization, retention/backups, encryption, cross-border processing authorization, SSL identity and network connectivity from Cloudflare.
5. Provision a restricted Aiven app role; do not give the app `avnadmin` or use credentials previously pasted into logs. Rotate exposed source/target credentials and any leaked API token.
6. Configure encrypted `DATABASE_URL` in the verified Cloudflare runtime, not in Git or Pages client-visible environment variables. Enable `NEWCHANGES_DATABASE_PROVIDER=aiven`. Keep `NEWCHANGES_AIVEN_PRODUCTION_APPROVED` unset until the final switch.
7. Test login/MFA, session continuity, tenant isolation, admin operations, dashboard queries, and write paths on an isolated release with safeguards. Gate cron/queues/background workers to guarantee one authoritative writer.
8. At maintenance cutover, take an independently verified recovery point, enable explicit Cloudflare write ownership, change the approved runtime to Aiven, validate functional health and write operations, and monitor Aiven capacity/errors. Keep Neon online as rollback source but fenced from concurrent writes. Rollback requires reconciliation of writes made on Aiven; simply changing URLs can lose data.

## Non-goals
- Changing the existing production service or deleting Neon.
- Dropping the current Aiven schema.
- Paid plan upgrade.
- Claiming Cloudflare is production-ready based only on a Pages deployment or a passing schema comparison.
