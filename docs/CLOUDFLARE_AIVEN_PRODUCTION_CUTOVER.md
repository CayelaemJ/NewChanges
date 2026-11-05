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


## Active production host contract (2026-11-05)

**Cloudflare is to be the always-live application primary, never a standby.** The actual full Node 24 Fastify/Prisma application is behind `cloudflare/main-app/worker.mjs` and the `NewChangesMainContainer` class; the Pages preview is not the backend. On the Cloudflare production container, `STANDBY_MODE=false` and `TRAFFIC_SAVER_MODE=false`. No public backend routing is enabled until the complete gate is satisfied.

The Worker accepts only `NEWCHANGES_AIVEN_DATABASE_URL` as its server-side database secret (never put it in client-facing Pages env). Runtime `DATABASE_URL` is injected into the container. The preflight requires `NEWCHANGES_DATABASE_PROVIDER=aiven` and a dedicated non-owner Aiven user, plus matching service host and database. The Worker and container both refuse active release without independent gates:
- `NEWCHANGES_BACKEND_ENABLED=true` with an exact dedicated canonical hostname and an installed Container binding;
- `NEWCHANGES_WRITE_LEADER_ENABLED=true`, `NEWCHANGES_CUTOVER_APPROVED=true`, `NEWCHANGES_DATABASE_PERMISSIONS_VERIFIED=true`, `NEWCHANGES_TENANT_E2E_VERIFIED=true`;
- `NEWCHANGES_SOURCE_WRITERS_FENCED=YES`, `NEWCHANGES_FINAL_SYNC_VERIFIED=YES`, `NEWCHANGES_AIVEN_PRODUCTION_APPROVED=YES`.

**These are human release attestations, not automated proof.** Do not set them until the corresponding technical evidence is recorded. Keep all deployment flags disabled until actual final sync, production domain, Docker image, access control, Cloudflare billing entitlement and operational tests are verified.

The container image includes the preflight and database-identity module. Build on Linux/amd64 with `docker build -f Dockerfile.cloudflare .`; do not run schema migrations on startup. The former Worker used a Neon-specific secret; the active primary uses the Aiven secret exclusively.

**Always live vs never sleeping:** `STANDBY_MODE=false` enables primary application behavior; it does *not* guarantee the Cloudflare Container process will stay resident 24/7. The current Container class has `sleepAfter=20m`. Request routing can bring it back, but on-process Node cron jobs will pause while it sleeps. Before go-live, move required authoritative schedules to durable Cloudflare Cron/Queues or another explicitly approved continuously running worker, with a single writer and tested idempotency. Do not assert scheduled-job parity without this.

## Runbook for final sync

Aiven contains a verified **stale snapshot**. Source writes continue. Never mark `NEWCHANGES_FINAL_SYNC_VERIFIED=YES` based on matching schemas or historical row-count checks alone. Arrange an operator-controlled maintenance window, drain/fence legacy web writes AND every job/ingestion worker, take a verified independent recovery archive, choose a capacity-safe method to refresh existing Aiven data, and compare source/target at one frozen checkpoint. The previous import script requires an *empty* destination and cannot run again on the populated Aiven database; do not bypass that guard, drop tables, or restore over the top.

Verify PostgreSQL sessions/authentication, app-managed MFA state, source connectors and MySQL integration separately. If cloud hosting or database credentials have been pasted into logs, rotate before production secrets are installed. Keep Neon intact for rollback and define how any writes made after cutover would be reconciled.

## Local static regression checks

```sh
node --test tests/cloudflare-main-app-container.test.mjs cloudflare/main-app/aiven-production-preflight.test.mjs
node --check cloudflare/main-app/worker.mjs
node --check cloudflare/main-app/preflight.mjs
```

None of these checks deploys the image, enables billing, configures customer traffic or tests the live app.
