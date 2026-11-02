# Aiven free-plan migration gate (The Fixer)

Destination: Aiven PostgreSQL 17, free-1-1gb, do-blr. Source candidate: Neon newchanges-primary-pg18, PostgreSQL 18.

## Verified read-only facts (2026-11-02)
- Aiven service RUNNING, 1,024 MB allocated, application tables 0, approximate initial database usage 7.6 MiB.
- Neon source database around 408 MiB, 57 public tables.
- Neon extensions include pg_session_jwt 0.5.0 and pg_stat_statements 1.12. Aiven does not list pg_session_jwt; Aiven pg_stat_statements latest listed 1.11.
- No public functions or views directly referencing pg_session_jwt were found, but dependencies outside those objects have not been ruled out.
- PostgreSQL 18 -> 17 downgrade is not guaranteed. Existing dr-migrate/migrate.sh intentionally refuses mismatched majors.

## Hard stops before any data transfer
1. Independently establish that this Neon database is the live The Fixer DATABASE_URL target; do not assume from the name.
2. Do not restore an unmodified PostgreSQL 18 dump directly to 17. Produce a schema-only compatibility trial in an isolated PostgreSQL 17 database with no application secrets; inventory extension-owned objects and any function/column types that depend on unavailable extensions.
3. Preserve users, roles, history and audit data. Exclude regenerable caches only after proving regeneration and receiving approval.
4. Enforce a free-plan ceiling and reserve at least 30% headroom for future writes and restore overhead. Abort if projected restored size plus WAL cannot fit.
5. Never set disk_space_mb, change plan, create paid resources, or enable chargeable backups. Monitor the Aiven dashboard for billing and quota status.
6. Store database credentials in an approved secret manager, never in repository, terminal logs, or documents. Rotate exposed Aiven password.
7. Before any copy of real data to India, review lawful cross-border transfer and approved handling requirements under POPIA.
8. Perform migration only from a secure, approved execution environment. Keep Neon and production DATABASE_URL unchanged.
9. Validate schemas, row counts, key aggregates, user login, tenant isolation, and reports against an isolated deployment.
10. A production cutover requires an explicit separate go/no-go decision, write freeze, final sync, rollback steps and sign-off.

## Next engineering work
- Test source schema against PG17, including extension exclusions.
- Create a non-destructive, opt-in copy script with restore failure abort, no forced reset and audit-friendly summaries.
- Do not run any production write or cutover through this PR.
