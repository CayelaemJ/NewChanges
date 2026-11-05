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


## 2026-11-02 implementation findings
- Verified source database: 427,761,664 bytes, 57 public tables, 2 public views, 13 public functions.
- No public RLS policies or RLS-enabled tables; application-layer authorization must be separately checked during isolated tests.
- Aiven destination is still RUNNING, empty of application tables, on free-1-1gb in do-blr; no resource expansion or cutover occurred.
- Aiven currently offers PostgreSQL 18. Its default new-service major is 18; destination was created earlier on 17.
- Attempted in-place Aiven update to PostgreSQL 18 was **rejected** by the API: required `upgrade_check` task absent. Service remains on PostgreSQL 17. No paid plan was selected.
- Preferred path: run Aiven's compatibility check and upgrade **the existing empty free service** to PostgreSQL 18, keeping the exact free plan and do-blr region. Aiven Console: Service settings -> Service management -> Actions -> Upgrade version -> 18; review the compatibility result before applying. Do not click Upgrade plan.
- Fallback path: `scripts/aiven-pg17-local-schema-test.sh` performs a **schema-only** local Docker trial against disposable PG17, with no Aiven or Neon writes. It requires locally installed PostgreSQL 18 dump tools and an existing postgres:17-alpine image. This is not a data migration.
- The app's PostgreSQL auth session/tenant checks must be tested explicitly after migration; no database RLS policies were present in the inspected source.
- Aiven free provides one node, 1 GiB storage and a max of 20 connections; it is for small-scale testing and not guaranteed high-availability production.
- Source database bytes are not the same as historical network egress; do not equate the 408 MiB source with a reported 500 GB of usage. Migration must be one-shot and never retry in an unbounded loop.
- The target credential was exposed in chat and must be rotated before deployment; do not embed it in PR files.
