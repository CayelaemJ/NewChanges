# Neon query-cost audit — 2026-10-16

## User-supplied query evidence
- Session/user/employer lookups: 18,664 executions each.
- Data-access audit inserts: 9,152 executions.
- EmployeeVersion site-name DISTINCT: 4,744 executions, reportedly 64.5% of measured query execution time.
- Import-batch lookups: 4,888 executions.

The above counts have not been independently verified against a defined Neon time window.
They are query-profile observations, not billing totals or proof of importer resets.

## Low-risk improvements in PR 153
1. `src/server.ts`: request-scoped WeakMap de-duplicates session resolution between authorization and the onResponse audit hook. No cross-request auth cache; permission revocations remain effective on the next request. Auditing is retained.
2. `src/services/snapshotBuilder.ts`: historical site-name DISTINCT results and registered site names are reused for up to 60 seconds per employer (max 200 employers per process) with concurrent promise deduplication. `snapshotEmployer` invalidates the employer entry. This is not a tenant-shared global cache and does not contain PII or permissions.
3. Regression tests: cache eviction, concurrent reads, failed loads and code wiring. These changes do not alter source cursors, import budgets or production data.

## Verification and next fixes
- Confirm exact query fingerprints, date range, p50/p95 latency, calls per dashboard load, total execution time, index hit rate and buffer reads using Neon query statistics.
- Measure 30-minute before/after windows at comparable load. Expect fewer site DISTINCT executions and authentication queries; do not assert a percentage reduction before measurement.
- Keep per-request access audits for sensitive routes for accountability. Explore batching/partitioning or retentions only after governance review, not silent sampling or dropping audit events.
- Profile repeated ImportBatch SELECTs and dashboard payload work. Avoid changing them without traces showing the actual caller and a freshness/recovery-safe design.
- If historical site DISTINCT remains expensive after caching, compare EXPLAIN ANALYZE and a maintained site dimension table/aggregation versus adding indexes (which carry storage and write cost). No speculative indexes on a small Neon plan.
- Review auth token revocation, same-request security changes, cache staleness and multi-host Railway/Render behavior before rollout.
- Do not deploy or merge this PR before approval and successful tests.

## Live Neon verification — 2026-10-16

Read-only inspection of project `newchanges-primary-pg18`, using existing
`pg_stat_statements`, confirmed:

- Historical `SELECT DISTINCT EmployeeVersion.siteName` by employer:
  4,744 calls, 254,808 ms total, 53.71 ms mean.
- Repeated Employee/EmployeeVersion as-at projection:
  4,744 calls, 22,997.5 ms total, 4.85 ms mean.
- ImportBatch listing query: 4,888 calls, 923.5 ms total,
  0.19 ms mean, 487,050 cumulative returned rows.
- EmployeeVersion physical table + indexes: approx 189 MB.
- DashboardCohortCache: approx 61 MB.
- DataAccessEvent: approx 19 MB.
- ImportBatch itself: approx 232 kB.

The frequent ImportBatch query corresponds to an Admin import-history listing;
the legacy Admin page was polling every 1.5 seconds regardless of scroll position.
PR #153 now polls every 30 seconds only while the card is visible, and adds
manual Refresh. This should reduce **idle** history polling by up to 95%
per continuously visible Admin tab (20x slower), or more when off-screen;
the real reduction remains unmeasured until deployment and comparable usage.
The feed-coverage aggregation change is separate from this polling source.

The SQL metrics are accumulated statement statistics, not same-day billing.
No baseline was reset, no EXPLAIN ANALYZE ran, and no production database rows
or schema were modified during this inspection.

## Explicit outstanding gates
- CircleCI green on the exact PR head and authorised rollout are required.
- Measure post-deployment queries/costs under comparable load, verify site options
  and role/tenant permissions on Railway and Render.
- Source-agnostic ten-feed importer remains a staged design; source snapshot
  consistency, mapping approval, bounded writes, durable restart and object
  storage are not yet production-verified.
