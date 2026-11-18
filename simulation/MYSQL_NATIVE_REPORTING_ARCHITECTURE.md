# PR #237 — Independent MySQL-native reporting architecture

## Non-negotiable data boundary

The Fixer application PostgreSQL database is exclusively for application
identity, authorization, settings, and other application-owned records.
**Never INSERT/UPDATE/UPSERT/COPY** reporting source rows, aggregates,
CDC transaction records, checkpoints, feed generations, cache payloads,
reporting projection tables, or CDC worker leases into PostgreSQL.

The reporting source of truth is independent AWS RDS MySQL `ingest_stage`:
ten canonical physical tables and ten existing canonical `v_*` views.
The reporting API may perform **read-only**, scoped SQL queries against MySQL
to return ready-to-chart aggregates. Do not duplicate base datasets in
PostgreSQL and do not migrate reporting workloads into app-store models.

## Responsibilities

- **MySQL:** canonical data; existing reporting views; index-backed,
  parameterized, bounded SQL measures, comparisons, trends, rankings and
  breakdowns. Rows stay in MySQL. MySQL *executes* analytics; chart rendering
  remains in the browser.
- **CDC consumer:** MySQL ROW binlog INSERT/UPDATE/DELETE committed transaction
  detection with source/table allowlist, transaction/XID boundaries, rotation
  handling, strict TLS, change-scoped invalidation only (no row payload
  forwarding). Auth/access controls do not come from raw binlog events.
- **CDC operational state:** durable checkpoint, feed generation, leases and
  fencing in a dedicated independent reporting control plane. A narrowly
  scoped MySQL operational schema on reporting RDS is one candidate, but
  deployment/DDL, table design, write privileges and retention require a
  separate review; **not** PostgreSQL app store. Until chosen, keep
  production CDC disabled. A process-local map or SQLite file cannot
  substitute for multi-instance reliable worker state.
- **Reporting API:** returns only explicitly allowlisted, authorized,
  parameterized measures; bounded row count/timeouts, employer/tenant scope,
  request deduplication and measured cache. No reporting writes to app store.
- **Browser:** renders charts/KPIs and subscribes to version notifications.
  Notifications are hints; re-query the authoritative MySQL reporting views.
  Authenticated SSE/WebSocket is optional; a small version endpoint with
  periodic fallback handles reconnects and dropped notifications.

## Database performance and query plan

1. Profile actual dashboard query shapes with EXPLAIN ANALYZE, timing and
   cardinality; do not assume the ten existing views are efficient.
2. Add *measured* composite indexes on underlying tables for frequent filters
   and joins (e.g. employer/time/status only if those columns are confirmed).
   A MySQL view is not a materialized view and cannot be indexed as if it were
   a standalone physical table.
3. Push down filters, grouping, time bucketing, sums and denominators to
   MySQL; expose narrow metric-specific query contracts and bounded outputs,
   not SELECT * / huge row hydration in Node.js.
4. Parameterize tenant/employer filters; schema/view names must come from
   static allowlists; prevent cross-tenant leakage even across shared caches.
5. Use short-lived caches keyed by source/feed, employer scope, filters,
   report revision and confirmed feed generation. On matching committed CDC,
   invalidate only impacted metric queries. If view dependencies involve
   multiple feeds, invalidate their full dependency closure.
6. For expensive repeated aggregations, benchmark query optimization before
   considering **separately reviewed MySQL-side** summary tables. MySQL has
   no native auto-refresh materialized views; incremental summaries add
   source-side writes, maintenance cost, failure/recovery semantics.
7. Separate source data freshness, CDC capture lag, query latency and browser
   rendering latency in the operator health view. Avoid invented SLA claims.

## Correctness / safety gates

- An initial validated notification baseline is needed for an existing
  populated source. Never bootstrap a durable CDC checkpoint from current
  binlog tip without a consistent handoff.
- A MySQL commit does not guarantee immediate chart delivery. Monitor
  end-to-end latency and preserve a bounded polling fallback.
- Connection interruptions, expired binlog retention, schema changes, worker
  failover and invalid checkpoints must fail closed, not silently skip history.
- Binlog privileges can expose rows from other schemas before client-side
  filtering. Complete privileged-data exposure and privacy review.
- Existing canonical views must remain unmodified until the reporting
  contracts, permissions and performance are measured.
- Do not activate production worker, alter live RDS, create a new schema,
  or execute migrations without separately approved operational rollout.

## Explicit prohibitions

- No PostgreSQL reporting mirror, Bronze/Silver/Gold copy, denormalized
  reporting dataset, CDC log, checkpoint, feed-generation or worker lease.
- No client-side processing of hundreds of thousands of source rows.
- No blind refresh of all 10 feeds for every source change.
- No reliance on `source_updated_at` as a substitute for real binlog CDC.
- No automatic new MySQL writes/triggers/aggregator tables without review.

## Release sequence

1. Audit and optimize query plans for ten existing views and targeted
   dashboard metrics, keeping all changes read-only initially.
2. Establish MySQL-native reporting endpoint contracts (feature-disabled
   until real permissions/tenant mapping and view projection verified).
3. Implement a durable CDC reporting control plane independent of Postgres
   with verified checkpoint, lease and failover.
4. Wire committed binlog notifications to scoped dashboard query-cache
   invalidation; verify XID-only publication, reconnect and replay.
5. End-to-end measure MySQL commit → binlog consumed → API version advanced
   → scoped view queried → chart rendered; test burst volume and failure paths.
