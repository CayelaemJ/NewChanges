# Direct AWS MySQL reporting — first implementation slice

## Goal
Keep AWS RDS MySQL as the authoritative reporting datastore. Railway PostgreSQL is for application-owned records (login, MFA, users, configuration, audit, jobs). Do **not** continuously copy employee, debt, policy, journey or other source rows into PostgreSQL simply to serve charts.

## Implemented in this branch
- `src/services/directMysqlReporting.ts`: explicit SQL/MySQL-only, allowlisted canonical reporting-view aggregate reader. Fixed parameterized count and source freshness per feed, optional employer filter. No import, cursor advancement, Prisma projection, or PostgreSQL business-row write.
- `GET /api/admin/integration/direct-reporting/summary?reportKey=employees&employerRef=...`: MFA-protected admin-only endpoint. Server-side feature gate `DIRECT_MYSQL_REPORTING_ENABLED=true`; otherwise 503.
- Strict TLS certificate verification, bounded query timeout, identifier validation, no arbitrary SQL, no multi-statements, read-only transaction.
- Source-side journey activity KPI: `GET /api/admin/integration/direct-reporting/journey-kpis?employerRef=EMP-123&startDate=2026-01-01&endDate=2026-02-01`. Returns started journeys, completed-of-started journeys and summed monthly savings for completed journeys started within the period. This is **not** the full score or monthly dashboard calculation.\n- Unit tests: `npx vitest run quality-tests/direct-mysql-reporting.test.ts`.

## Configuration
1. Create a MySQL user with **SELECT only** on specifically approved `v_<reportKey>` reporting views; no base-table access, DDL, DML, or privileged functions. Rely on MySQL GRANTs — SQL read-only transaction alone is not a permission boundary.
2. Ensure AWS security group permits traffic from the Railway service only via an appropriate restricted network route, and RDS TLS CA validation succeeds. Do not publicly expose MySQL broadly.
3. Configure source via existing Admin integration UI / secret vault, or `SOURCE_MODE=SQL`, `SOURCE_SQL_DIALECT=MYSQL`, `SOURCE_SQL_HOST`, `SOURCE_SQL_PORT`, `SOURCE_SQL_DATABASE`, `SOURCE_SQL_USERNAME`, `SOURCE_SQL_PASSWORD`, `SOURCE_SQL_SSL=true`. Do not commit credentials.
4. After connectivity and privileges are verified, set `DIRECT_MYSQL_REPORTING_ENABLED=true` in Railway. This flag alone does **not** activate the customer-facing dashboard.\n5. `DIRECT_MYSQL_NO_REPLICATION=true` independently blocks manual/scheduled source synchronization and destructive full refresh **before** database writes or purges. Leave this OFF until customer-facing dashboard reads no longer depend on copied PostgreSQL records. The guard does not block explicit user uploads, which are separate application actions.
6. Test both admin reporting endpoints with valid authenticated MFA session; examine query load, return values, source timezones and freshness. The journey view must have `started_at`, `status`, `monthly_saving_rand` and `employer_ref` as defined by the canonical contract.\n7. Do not enable source-to-PostgreSQL business synchronization as a substitute for direct reporting. The full dashboard still requires read-path parity before disabling its existing write model.

## Important limitations and future tasks
- **Not a full dashboard migration yet.** `snapshotBuilder.ts` currently reads PostgreSQL business projections, so switching `analyticsMode` alone does not route actual dashboards to MySQL.
- Source views must include `employer_ref` and `source_updated_at` columns. A view without these fields fails closed.
- This first endpoint is admin-only. Tenant-facing routes must resolve employer access server-side rather than trusting arbitrary client-supplied `employerRef`.
- Next: implement MySQL-side curated KPI/period/cohort query contracts, validate agreement with existing financial/temporal logic, wire `getDashboardPayload` through an explicit per-feed read router, run parity tests, then disable source-to-PostgreSQL business-row synchronization in production.
- Continue retaining PostgreSQL audit/security/configuration records and permitted small metadata. Don't delete existing models/migrations or turn on source-side automatic writes.
- Set `STANDBY_MODE` appropriately only after confirming one writable primary and approved background workers. This branch does not change Railway variables or existing deployment.

## Safety validation
Confirm through SQL audit and tests that direct dashboard endpoints do **not** invoke `commitSyncRows`, `commitBatch`, source-history upserts, `snapshotEmployer` writes, or advances integration cursors. For full production migration, separately test all ten feeds, historical as-of behaviour, deleted records, tenant isolation, user roles, MFA, non-reporting workflows, and performance.
