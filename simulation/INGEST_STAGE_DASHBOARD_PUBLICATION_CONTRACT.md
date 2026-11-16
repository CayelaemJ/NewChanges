# The Fixer — CDC-driven MySQL dashboard publication contract

**State:** internal application prototype; no production route or RDS consumer enabled.
**Date:** 16 November 2026. This document applies to PR #237 on
`feature/aws-rds-mysql-synthetic-cdc-20261106`.

## Goal: live CDC signals without reporting row duplication

```text
Existing authoritative MySQL (ingest_stage ten canonical feeds)
    │
    ├─ source rows and canonical v_* views stay in MySQL
    └─ committed ROW/FULL binlog transaction
          │
          ▼
   [Future authorized CDC reader and consistent snapshot]
          │
          ▼
   Metadata-only checkpoint + per-consumer, per-feed generation
          │
          ▼
   Feed invalidation [not a new dashboard publication]
          │
          ▼
   [Future tenant-authenticated read-only MySQL query/aggregation]
          │
          ▼
   Cache filled completely, old cache retained on failure
          │
          ▼
   [Future atomic new dashboard version + authorized SSE]
```

PostgreSQL remains authoritative for the application's **own** state,
not for a second raw mirror of the reporting tables. Do not call
`src/services/syncService.ts` or its existing import/upsert path from
CDC notifications: it stages and merges canonical rows into PostgreSQL.

## Verified findings (operator's live read-only RDS outputs)

- All ten `ingest_stage.v_*` reporting views exist and expose
  `source_updated_at`, but the underlying source `TEXT` timestamps are
  nullable and have **no column-level ON UPDATE maintenance**. A generated
  UTC projection alone does not repair a stale or absent timestamp.
- All ten base tables expose `_ingest_id`; **none** of the ten
  canonical views exposes it. Therefore **feed-level invalidation**
  is appropriate until physical-to-business identity mapping is verified.
- `log_bin=ON`, `binlog_format=ROW`, `binlog_row_image=FULL`.
- Effective **RDS binlog retention hours=NULL**, which means no
  guaranteed external CDC replay horizon.
- Latest operator-verified **disposable Docker CDC suite: 118/118 PASS**.
  No live AWS CDC worker is enabled.

## Implemented, not wired to any HTTP endpoint

### 1. MySQL-only view reader

`src/services/ingestStageCdcMysqlReader.ts`:

- Fails before opening a connection unless feature, source-access-review
  and snapshot-verification gates are true. These are *assertions* and
  **not proof** of real operator authorization or a consistent snapshot.
- Accepts server-supplied, validated employer scope; rejects arbitrary
  report keys, names of other schemas and the RDS master account.
- Uses TLS CA verification **and** MySQL2 `verifyIdentity: true`;
  all report SQL arguments are parameterized and identifiers are
  derived from canonical report formats, not request text.
- Reads in a MySQL **read-only snapshot transaction**, only
  allowlisted fields, without filtering by `source_updated_at > ?`.
- Maximum of **2,000** source rows per employer/feed read. A
  `LIMIT maxRows+1` detects oversized results. It **fails entirely**
  instead of publishing truncated reports.
- This row limit is restrictive for large real sources. **Do not**
  activate the reader for high-volume reporting without first
  implementing query-budgeted **server-side aggregations** and
  verifying parity against the current dashboard's period, site,
  income, historical and deletion semantics.

### 2. Process-local metadata publication coordinator

`src/services/ingestStageCdcFeedPublication.ts`:

- Accepts a verified source-read function and returns **only**
  `{feed, employerRef, generation, rowCount, publishedAtMs}`.
- Uses a process-local, employer-and-feed-scoped cache. Raw payroll
  identifiers, debt amounts, identities and other reporting rows
  are not persisted in this cache or to PostgreSQL.
- Coalesces simultaneous refreshes for the same feed/employer;
  an arriving higher generation causes a *subsequent* read.
- Uses a configurable short TTL and a hard metadata cache capacity;
  requests for distinct keys reserve capacity even while in flight.
- Declines unapproved scopes, invalid generations, missing
  approvals, oversized or incomplete reads. Failed reads leave
  the last successful generation unchanged; no checkpoint advance
  or dashboard SSE event is published.
- This cache is **not durable or shared across app instances**.
  Its generations cannot be used directly as production SSE
  versions, nor can it replace a durable CDC checkpoint.

### 3. Tests

`npm run check:cdc-dashboard` runs:

- `tests/ingest-stage-cdc-mysql-reader.test.ts`: 11 mocked checks
  for tenant isolation, RDS/TLS limits, read-only SQL, rollback,
  cross-tenant leakage and incomplete-result handling.
- `tests/ingest-stage-cdc-feed-publication.test.ts`: 19 mocked checks
  for all ten feeds, version monotonicity, concurrent notifications,
  capacity reservation, refresh errors, expiry, and metadata-only
  publication.

The new Node suite is **30 tests, added but not yet executed by
the operator**; `npx tsc --noEmit` is likewise pending.
The earlier **118/118 Docker PASS** is a separate Python/MySQL
test suite and cannot be counted as a Node regression pass.
The new command is included in `package.json`'s `check:all`.
It is also invoked directly by the `.circleci/config.yml` **verify**
job, following existing `check:source-sync-safety` tests. The latest
additional test composes the actual TypeScript MySQL view reader (with a
mocked DB connection) and the metadata coordinator, verifying source
ROW field minimization, read-only snapshot SQL, no write statements,
and that raw payroll references are not retained in the publication.
**No CI result is claimed yet for these new tests.**

## Admin source inventory and future multi-database use

New `GET /api/admin/data-sources/overview` is protected by
`requireAdmin` and returns only a sanitized connector inventory
and the **existing** process-local source watcher state.
`/react/admin` → **Data sources & CDC** displays configured
source details, staged candidates, selected connector types,
CDC launch gates and real, explicitly legacy polling activity.
It uses a **fixed** link to `/admin#live-integration` to
preview/stage an additional source without replacing the
currently configured one.

This is not yet simultaneous live database federation. Existing
`SourceGeneration` and `canonicalSchemaDiscovery.ts` /
`canonicalSchemaMapping.ts` modules provide bounded stage
metadata and **offline ten-feed schema mapping previews**.
A future independent source registry, identity/metric mapping,
CDC connectors, authorized source-side aggregates and durable
cross-worker version publication are required for true plug-and-play.

The independent Node command now includes a third test file,
`tests/data-source-control-center.test.ts` (**10 more tests**)
for secret redaction, admin authorization, source-stage states,
legacy watcher semantics and React admin route wiring.
**Total pending Node regression cases: 40**; separate verified
Docker/Python baseline remains **118/118**. Do not claim
these new Node tests passed without execution evidence.

See `MULTI_SOURCE_CONTROL_CENTER.md` for the next database's
onboarding lifecycle, UX and cost/latency monitoring plan.

## Production launch gates (open)

1. Review MySQL RDS external replication's broad binlog visibility
   and the privacy implications of mixed data on one RDS instance;
   approve least privilege and compliance scope before granting
   privileges to any consumer.
2. Set **approved** RDS binlog retention (proposal: 24 hours,
   **not applied**) only after confirming binlog growth and free
   storage; instrument lag, stale checkpoints, purges and backups.
3. Create a **real** consistent snapshot and verified import
   manifest/initial state, then verify binlog coordinates and
   nonempty source row totals. Never start at today's binlog tip
   to mask an unapplied history.
4. Assign a **separate read-only SQL account**, scoped to the ten
   allowed views, with TLS and no RDS admin credentials; check
   permissions through database-side grants, not account naming.
5. Map authenticated application sessions to canonical
   `employer_ref` values using reviewed tenant authorization.
   Never accept an employer list from the browser or query string.
6. Build scalable **aggregated** read queries and regression-check
   parity across periods, employers, site/income filters, late
   business dates, hard deletes, and cost/load profiles. A raw
   feed row-count preview is **not** the business dashboard.
7. Define and test durable, multi-worker cache publication:
   retain the last successful payload on error; atomically publish
   a version only *after* all required aggregates are ready,
   with SSE/HTTP polling re-checking authorization and version.
8. Update deployment checks, cost monitors, runbooks and rollback
   without relaxing the local-only Docker fixture guards.

**No AWS source write, production RDS read, new route, SQL grants,
database migration, PostgreSQL reporting replication, or deploy
was part of these application prototype changes.**
