# User-first PostgreSQL migration (not SQL source ingestion)

NewChanges Prisma uses PostgreSQL for its application state. This migration intentionally leaves external MySQL / SQL Server / SQL API integrations completely unchanged.

## Initial identity scope
- Partner, Employer, DashboardSection, User, UserEmployer, UserSectionAccess
- Session is an optional `--include-sessions` copy. Cross-host cookies are not shared automatically, so users may still need to sign in again after failover.
- Password hashes, account role, activation/revocation details, partner links, and dashboard access settings are retained with the user record.
- Employer identity shells are required by `UserEmployer` foreign keys; historical cohorts are not copied.
- `ReportSchedule`, integration cursors/configuration, stored credentials, analytics and snapshots are **not copied**.

## Preconditions
1. Provision a durable PostgreSQL database **outside Railway and outside temporary Render Free Postgres**. This cannot be safely achieved solely by creating a free web service.
2. Install the same Prisma schema and relevant SQL functions on the new database. **Never** run a reset or force schema migration on the Railway primary.
3. Schedule a write-free migration window, take a separately restorable encrypted backup, and ensure the target identity tables are empty.
4. Set `DR_SOURCE_DATABASE_URL` and `DR_TARGET_DATABASE_URL` as secrets in the operator environment (never commit them).
5. Run `node scripts/migrate-identity-postgres.mjs` for validation and table counts, then (after operator approval) `node scripts/migrate-identity-postgres.mjs --apply`.
6. Verify sign-in and role/employer/section permissions. Only then connect the standby application to the new database.

## Important
This is a **one-time identity copy** and NOT ongoing replication or automatic failover. Changes to users made on Railway after this copy do not propagate. For ongoing synchronization, use a single external writable PostgreSQL primary for both apps, or design and validate PostgreSQL logical/streaming replication with explicit writer promotion and fencing. Do not run two independent writable primaries.

The app's standby mode currently suppresses startup schedulers but does not block manual HTTP writes. Before enabling standby traffic or admin writes, introduce API-level write fencing, centralized readiness checks, and failover authorization.
