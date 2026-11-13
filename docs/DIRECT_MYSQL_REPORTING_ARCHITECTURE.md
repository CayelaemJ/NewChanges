# Direct AWS MySQL reporting — first implementation slice

## Goal
Keep AWS RDS MySQL as the authoritative reporting datastore. Railway PostgreSQL is for application-owned records (login, MFA, users, configuration, audit, jobs). Do **not** continuously copy employee, debt, policy, journey or other source rows into PostgreSQL simply to serve charts.

## Implemented in this branch
- `src/services/directMysqlReporting.ts`: explicit SQL/MySQL-only, allowlisted canonical reporting-view aggregate reader. Fixed parameterized count and source freshness per feed, optional employer filter. No import, cursor advancement, Prisma projection, or PostgreSQL business-row write.
- `GET /api/admin/integration/direct-reporting/summary?reportKey=employees&employerRef=...`: MFA-protected admin-only endpoint. Server-side feature gate `DIRECT_MYSQL_REPORTING_ENABLED=true`; otherwise 503.
- Strict TLS certificate verification, bounded query timeout, identifier validation, no arbitrary SQL, no multi-statements, read-only transaction.
- Three additional source-side event metrics: `GET /api/admin/integration/direct-reporting/event-metrics?feed=ratings|referrals|salary_advances&employerRef=EMP-123&startDate=2026-10-01&endDate=2026-11-01`. The `feed` parameter is one value, not a pipe-separated list. Returns event count, rated-five-star/converted-referral/finalised-advance count, plus finalised salary-advance amount where applicable. Counts are based on `created_at`, `shared_at`, or `advanced_at` respectively. These are event-cohort metrics, **not** the entire historical dashboard.\n- Source-side journey activity KPI: `GET /api/admin/integration/direct-reporting/journey-kpis?employerRef=EMP-123&startDate=2026-01-01&endDate=2026-02-01`. Returns started journeys, completed-of-started journeys and summed monthly savings for completed journeys started within the period. This is **not** the full score or monthly dashboard calculation.\n- Unit tests: `npx vitest run quality-tests/direct-mysql-reporting.test.ts`.

## Configuration
1. Create a MySQL user with **SELECT only** on specifically approved `v_<reportKey>` reporting views; no base-table access, DDL, DML, or privileged functions. Rely on MySQL GRANTs — SQL read-only transaction alone is not a permission boundary.
2. Ensure AWS security group permits traffic from the Railway service only via an appropriate restricted network route, and RDS TLS CA validation succeeds. Do not publicly expose MySQL broadly.
3. Configure source via existing Admin integration UI / secret vault, or `SOURCE_MODE=SQL`, `SOURCE_SQL_DIALECT=MYSQL`, `SOURCE_SQL_HOST`, `SOURCE_SQL_PORT`, `SOURCE_SQL_DATABASE`, `SOURCE_SQL_USERNAME`, `SOURCE_SQL_PASSWORD`, `SOURCE_SQL_SSL=true`. Do not commit credentials.
4. After connectivity and privileges are verified, set `DIRECT_MYSQL_REPORTING_ENABLED=true` in Railway. This flag alone does **not** activate the customer-facing dashboard.\n5. `DIRECT_MYSQL_NO_REPLICATION=true` independently blocks manual/scheduled source synchronization and destructive full refresh **before** database writes or purges. Leave this OFF until customer-facing dashboard reads no longer depend on copied PostgreSQL records. The guard does not block explicit user uploads, which are separate application actions.
6. Test both admin reporting endpoints with valid authenticated MFA session; examine query load, return values, source timezones and freshness. The event views must expose their canonical fields: ratings `created_at`, `stars`; referrals `shared_at`, `converted`; salary advances `advanced_at`, `salary_advance_status`, `amount`, and all must expose `employer_ref`. The journey view must have `started_at`, `status`, `monthly_saving_rand` and `employer_ref` as defined by the canonical contract.\n7. Do not enable source-to-PostgreSQL business synchronization as a substitute for direct reporting. The full dashboard still requires read-path parity before disabling its existing write model.

## Important limitations and future tasks
- **Not a full dashboard migration yet.** `snapshotBuilder.ts` currently reads PostgreSQL business projections, so switching `analyticsMode` alone does not route actual dashboards to MySQL.
- Source views must include `employer_ref` and `source_updated_at` columns. A view without these fields fails closed.
- This first endpoint is admin-only. Tenant-facing routes must resolve employer access server-side rather than trusting arbitrary client-supplied `employerRef`.
- Next: implement MySQL-side curated KPI/period/cohort query contracts, validate agreement with existing financial/temporal logic, wire `getDashboardPayload` through an explicit per-feed read router, run parity tests, then disable source-to-PostgreSQL business-row synchronization in production.
- Continue retaining PostgreSQL audit/security/configuration records and permitted small metadata. Don't delete existing models/migrations or turn on source-side automatic writes.
- Set `STANDBY_MODE` appropriately only after confirming one writable primary and approved background workers. This branch does not change Railway variables or existing deployment.

## Safety validation
Confirm through SQL audit and tests that direct dashboard endpoints do **not** invoke `commitSyncRows`, `commitBatch`, source-history upserts, `snapshotEmployer` writes, or advances integration cursors. For full production migration, separately test all ten feeds, historical as-of behaviour, deleted records, tenant isolation, user roles, MFA, non-reporting workflows, and performance.

## Tenant-facing source KPI preview (PR #248)

The read-only route `GET /api/employers/:employerId/direct-reporting-preview?startDate=2026-10-01&endDate=2026-11-01` validates the authenticated application session, the same employer-access predicate as the existing dashboard, and MFA when enabled **before** retrieving source credentials. It executes four aggregate statements in one read-only MySQL transaction and returns journey, rating, referral and salary-advance KPIs. A user cannot choose another employer outside their authorized associations.

- The source views must be accessible with a least-privileged account granting `SELECT` and expose all canonical columns.
- Dates are half-open `[startDate, endDate)`, maximum 366 days, and reflect **event cohorts**; not historical stock snapshots.
- The new endpoint is **not** a replacement for `GET /api/employers/:employerId/dashboard`, `score-history`, monthly snapshot publication, or the current official optimising score.
- Keep `DIRECT_MYSQL_REPORTING_ENABLED` and `DIRECT_MYSQL_NO_REPLICATION` disabled in Railway production until MySQL network reachability, tenant membership onboarding, contract validation, parity tests, and security review pass. `STANDBY_MODE` remains a separate operational control.
- Follow-up dashboard migration must cover workforce as-at snapshots, debts, policies, historical joins, cohort filters, site/income dimensions, calculated scores, reporting schedules, and tenant-safe employer discovery from application metadata. Do not use the preview's event KPIs as a substitute for those calculations.

## Historical as-of preview (phase 3)

`GET /api/employers/:employerId/direct-reporting-asof-preview?asOfDate=2026-10-31` is an authenticated, tenant-authorized, MFA-gated preview. It reads three source-side historical aggregates under one consistent, read-only MySQL snapshot:

- `v_workforce_snapshots`: latest employer `eligible_count` where `as_of_date <= :asOfDate`; returns null if no eligible historical denominator is available.
- `v_debt_accounts`: latest observation per `account_ref` where `observed_at <= :asOfDate`, excludes tombstones and accounts closed on/before the as-of date, then counts accounts, arrears accounts and outstanding balances.
- `v_policies`: latest observation per `policy_ref` where `observed_at <= :asOfDate`, excludes tombstones and policies outside `effective_from/effective_to`; computes active policy count, premiums and unresolved wasteful-policy count.

**Critical preflight:** All views must expose full historical observation rows, **not** only current records. Verify `observed_at`, `source_updated_at`, `is_deleted`, `closed_at`, `effective_from`, `effective_to`, `is_wasteful`, `is_resolved`, `premium_rand`, `balance_rand`, and `in_arrears` as applicable. `is_deleted` is optional in the canonical ingestion contract; the view must expose it as a nullable false-default column for these historical queries or a reviewed view-specific query must be provided. These SQL assumptions have not yet been validated against live AWS RDS.

Snapshot dates are inclusive, while event KPI ranges remain half-open. For historical policy resolution, time-dependent fields MUST represent the state as observed, not retroactively overwritten present-day flags. Any disagreement with current PostgreSQL dashboard score calculations is a release blocker. As-of previews do not claim full scoring, site/income cohort parity, cross-feed temporal joins or dashboard publication. No import pipeline, PostgreSQL snapshot materialization, or production flag is changed by this PR.

### Performance and budget checks before rollout

Windowed account/policy queries can be expensive without appropriately indexed source tables or pre-aggregated source-side history. Obtain `EXPLAIN ANALYZE` for approved views with representative employer/date ranges on a non-production replica or at a safe query budget; measure RDS CPU, reads, latency and network egress. Review index strategy on underlying source tables (e.g., tenant + natural key + observed timestamp) without applying unsolicited SQL changes.
