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

## Source readiness gate — database metadata only

The administration endpoint `GET /api/admin/integration/direct-reporting/preflight` requires a valid admin session (and MFA when enforced) plus the direct-reporting feature flag. It uses parameterized `information_schema.TABLES` and `information_schema.COLUMNS` queries; it **never reads business rows**.

It currently checks the seven views that power event and as-of previews:
`v_journeys`, `v_ratings`, `v_referrals`, `v_salary_advances`, `v_workforce_snapshots`, `v_debt_accounts` and `v_policies`. A missing view, a base table substituted for an approved view, or a missing required column yields `ready: false` with specific deficiencies. The check does not expose passwords or connection URLs.

A `ready: true` response is **necessary but insufficient** for rollout: it cannot verify that a view contains all historical observations, handles late-arriving corrections correctly, implements source tenant scoping, or matches published financial scores. For those guarantees, compare representative employer-period outputs with the current PostgreSQL reports under a controlled read-only experiment, and inspect RDS query plans and CPU usage.

**Do not enable the no-replication cutover solely because metadata preflight passes.**

## Dashboard parity correction — journey temporal semantics

The existing dashboard uses `completed_at` for *completed-in-period* journey flows, but `started_at` for *started-in-period* activity. These cohorts are different: an October-started journey completed in November counts in October starts and November completions. The direct MySQL dashboard preview now returns both `completedOfStarted` (a start-cohort metric) and `completedInPeriod` (a completion-date flow metric), with corresponding monthly savings. Do not compare `completedOfStarted` to the existing completion-date KPI. This change only corrects the preview and does not claim full score parity, source tombstone handling, or accurate historical point-in-time status.

## Read-only parity probe — historical headcount only

`GET /api/admin/integration/direct-reporting/parity/:employerId?period=2026-10` compares a PostgreSQL dashboard's existing unfiltered, snapshot-backed historical headcount to the matching source MySQL workforce headcount. It returns:
- `PASS` only when the reporting as-of date, source observation date and eligible headcount all agree.
- `FAIL` when counts differ after the dates/source definitions agree.
- `NOT_COMPARABLE` for site/income cohort restrictions, fallback-derived headcounts, missing values, mismatched observation dates or unsafe numeric values.

The route requires an authenticated admin (including existing admin MFA checks), confirms employer authorization, and returns only an aggregate comparison. It writes no source business data into PostgreSQL.

**IMPORTANT:** A headcount `PASS` does **not** authorize switching the whole dashboard to MySQL. Completed journeys, policies, account risk, score weightings, site/income cohorts, historical corrections and publication semantics still require separate parity criteria and approved production tests. The endpoint calls the existing dashboard renderer for a single requested month and can incur PostgreSQL work; keep it admin-only and avoid bulk probing until load limits have been tested.

## Employer identity bootstrap without business-data duplication

An **empty** Railway PostgreSQL does not automatically contain the `Employer`, `UserEmployer` or role/permission records used by the existing `canViewEmployer` authorization checks. MySQL direct reporting alone cannot solve that authentication gap.

The new admin-only endpoint `GET /api/admin/integration/direct-reporting/employers?after=EMP-000` reads up to 100 records from the approved `v_employers` source view using a parameterized keyset cursor. It returns only `employerRef` and `name`, not employees, policies, debts or source credentials. The response is never persisted by this endpoint. The preflight now checks eight views, including `v_employers`.

After reviewing the source catalog, administrators must explicitly onboard **minimal identity anchors** (employer ID/name, authorized user links and tenant permissions) into PostgreSQL. Such small application-owned metadata is necessary for access control and is not equivalent to copying the reporting dataset. Do not auto-provision every employer or grant blanket access on a new environment.

**Current limitation:** employer discovery is implemented, but tenant onboarding/provisioning and live source reachability have not been verified. Without those records, existing employer-scoped dashboard routes correctly deny access. Do not bypass `canViewEmployer` as a workaround.

## Employer key semantics (verified in Prisma schema)

`Employer.id` is already defined as the **external stable `employer_ref`**, not an internal UUID. The `UserEmployer.employerId` relationship therefore authorizes the same key that the MySQL reporting views filter by. Do not introduce a second mapping table unless the source contract changes.

Both employer-scoped direct-preview routes now check an active `Employer` application record (`sourceDeletedAt: null`) after user/tenant authorization and before accessing MySQL source credentials. Superadmins cannot query an arbitrary undeclared employer reference via these preview routes. Only minimal control-plane employer anchors and user permissions are needed in Railway PostgreSQL, not copies of the underlying workforce or financial records.

## Railway configuration audit — 13 November 2026

The Railway production `NewChanges` service was verified to deploy `CayelaemJ/NewChanges` from `main`. Service-defined variables were `NODE_ENV`, `COOKIE_SECURE`, `DATABASE_URL`, and `STANDBY_MODE`; source-related variables such as `SOURCE_MODE`, `SOURCE_SQL_DIALECT`, `SOURCE_SQL_HOST`, `SOURCE_SQL_DATABASE`, `SOURCE_SQL_USERNAME`, `SOURCE_SQL_PASSWORD`, `SOURCE_SQL_SSL`, and `DIRECT_MYSQL_REPORTING_ENABLED` were not present. Railway-owned variables were present separately. No variable values were read or recorded. Therefore, **live AWS MySQL connectivity from Railway has not been established**.

The preflight reports `ready` for **view-schema compatibility only** and separately returns `productionCutoverReady: false`. Do not interpret a schema-ready response as authorization for `DIRECT_MYSQL_NO_REPLICATION=true`, source removal, or dashboard replacement. A cutover-ready result must require independently validated RDS network/TLS, least-privilege SELECT grants, historical completeness, employer isolation, dashboard metric parity, acceptable query plans, and a reversible operational rollout.

Until those gates are satisfied, keep production on its current `main` deployment, leave the source no-replication flag disabled, and do not introduce MySQL secrets into GitHub or this document.

## Verified AWS infrastructure and network cutover blocker — 2026-11-13

Read-only AWS API checks of `fixer-synthetic-mysql` in `eu-north-1` confirmed:

- Database status `available`, engine MySQL `8.4.11`, port `3306`, 20 GiB allocated.
- `PubliclyAccessible=true` but attached security-group inbound port `3306` was restricted to **one /32 IPv4 address** (not general Internet access). The approved CIDR is intentionally not reproduced here. Source reachability from Railway is therefore **unproven** and should be treated as blocked unless Railway traffic uses that approved IP or an approved private network route is in place.
- Storage encryption `true`, deletion protection `true`, RDS certificate authority `rds-ca-rsa2048-g1`; current automated backup retention 1 day. MySQL IAM database authentication disabled.
- Production Railway `NewChanges` is on `main` with no configured MySQL source variables as of the audit. These results are **network/control-plane evidence**, not MySQL authentication or reporting-view validation.

### Safe rollout checklist

1. Select an intentionally restricted network route from Railway to RDS: approved stable egress IP with a /32 security-group ingress entry, or private networking through a managed connector/VPC path. **Never add `0.0.0.0/0` to port 3306** just to make the test pass.
2. Configure MySQL connection details as Railway secrets or sealed environment variables, not source code or commit history. Use a dedicated reporting user with `SELECT` on approved views; do not reuse the RDS administrative user.
3. Validate trusted CA, hostname and TLS certificate; compare the RDS endpoint/CA to the application configuration. Existing previews require verified TLS.
4. From an appropriately restricted non-production runner/service, run the existing metadata-only `/api/admin/integration/direct-reporting/preflight` endpoint after enabling only the **read-only** feature gate. Capture the missing-column/view response, not business data or credentials.
5. Verify historical observation completeness, effective-dated semantics, employer authorization, source read latency/CPU and report parity before any dashboard switch. Schema-only `ready=true` still means `productionCutoverReady=false`.
6. Keep the no-replication flag and full customer dashboard cutover OFF; do not merge this draft PR until all required acceptance checks pass. Consider whether 1-day RDS backup retention meets the agreed recovery-point objective before production approval.

No AWS resources, security groups, Railway variables or live databases were modified by the AWS read-only inspection.
