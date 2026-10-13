# One authoritative PostgreSQL application layer — cutover plan

**Not an active migration.** No production database credentials or contents are stored in this repository.

## Target
Railway primary app + Render standby app → one independent **PostgreSQL** primary. Every existing external MySQL, MSSQL, SQL/API ingestion connector stays unchanged. No attempt to convert MySQL data sources into PostgreSQL.

## Non-negotiable verification before cutover
1. Identify the exact source from the *NewChanges application* `DATABASE_URL` (the service called `Postgres-h_Ck` is a candidate, not confirmed from the redacted connection reference).
2. Run `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/postgres-consolidation-size.sql` in a secure runner. Record `pg_database_size`, the largest tables, version, extensions and required roles. The source reports PostgreSQL 18.6 from its container tag, while the new Neon target is PostgreSQL 17: PostgreSQL **18 → 17 restore is not guaranteed to be supported**. Recreate a PostgreSQL 18 target or validate compatibility *before* a transfer.
3. Measure the entire dump, indexes, WAL/write overhead and growth headroom; stop if destination quota is insufficient. Neon Free currently reports 1 GiB for the created project; the Railway volume metric 1.51 GB is not an exact database size.
4. Take an encrypted offsite restore-point backup. Schedule maintenance: stop all application writes, source synchronization and scheduled jobs, including manual admin endpoints. A full dump is only a point-in-time copy, not continuous replication.
5. Provision an **empty, independent, suitably sized PostgreSQL destination** with TLS, suitable PostgreSQL version and restore permissions. Do not use a short-lived Render free Postgres instance as the authoritative store.
6. Perform a version-compatible `pg_dump -Fc` on source and `pg_restore --exit-on-error --no-owner --no-acl` to *empty target only*. Do not use `--clean`, `--create`, `db push --force-reset`, or any destructive fallback. Validate extensions, functions, constraints and row counts.
7. Test admin login (including existing hashes, roles, sessions), employer permissions, partner branding, cohorts, source connection configuration and full dashboard filtering in an isolated test service.
8. Only after sign-off: coordinate a write-free cutover, reconfigure Railway and Render secret `DATABASE_URL` to the same external primary, keep exactly one scheduler leader, then validate write/read on both. Keep old Railway DB intact for rollback.
9. Add separate encrypted backups and restore tests. A single shared DB is **not** itself database high availability; a DB outage takes both applications down. Automatic provider failover and DB replica promotion require additional engineering.

## Render safety
`STANDBY_MODE=true` currently suppresses scheduled jobs on startup but does **not** prevent all write endpoints or ensure complete standby readiness. Full DR routing must not be enabled until these safeguards are in place.

## Privacy
Users, sessions, passwords and employer information are sensitive: never log connection strings or include dumps in GitHub. Review POPIA cross-border storage/transfer implications for South Africa.

## 2026-10-13 destination verification
Created **Neon project `wild-base-70222190` (`newchanges-primary-pg18`)** in Frankfurt with PostgreSQL 18.6. Confirmed `newchanges` database contains **zero application tables**. The destination remains isolated and its free storage cap is **1 GiB**; it is not yet ready to receive production data. Older `snowy-flower-31527242` is PostgreSQL 17 and should not be used for the untested downgrade. No production Railway or Render secrets were changed.

The migration MUST STOP if measured source data plus growth headroom exceeds 1 GiB. Measure actual source size through a secure operator-controlled SQL session or approved runtime; Railway's connected integration exposes variable names but redacts the source connection value.
