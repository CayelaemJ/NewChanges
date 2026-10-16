# Dataset replacement: remaining production gates

This PR provides an isolated **local filesystem object-store adapter** for
Playground/CI and verifies ten source-scoped objects by reading their bytes.
It is intentionally **not a production S3/R2/Neon-storage adapter** and
does not extract, mutate, publish, delete, switch sources, or enable workers.

## Required before deployment or production replacement

1. Implement an authenticated production object-store GET adapter that accepts
   only pre-authorized generation-scoped keys; enforce request timeouts and byte caps.
2. Create a generation-specific ten-feed extraction/storage job using immutable
   keys, source watermarks and trusted per-feed row-count provenance.
3. Exercise the ten-feed readback against real Playground object storage.
4. Rehearse isolated Neon snapshot restore and verify tenant/user/role/permission
   mappings and FK integrity. Record operator-approved recovery evidence.
5. Prove single ingestion owner, complete cursors, scheduled refresh, error
   recovery, and atomic generation publication with a tested rollback.
6. Rehearse Railway/Render consistency without simultaneous writers; verify
   dashboard parity, performance, and object-storage/Neon cost impact.
7. Require release approval and CI/security sign-off. Preserve active production
   source and keep semantic publication disabled until gates pass.

## Isolated test

`npx tsx tests/dataset-replacement-playground-store.test.ts`

Creates only temporary local files; checks ten feed readback, deletion,
corruption, symlink denial, and path traversal. Cleans up after execution.

## Transfer and Neon capacity planning (read-only)

`reviewTenFeedTransferBudget` accepts exactly ten canonical feed estimates with
estimated row sizes and changed-row counts. It rejects unsafe numeric overflow,
missing or duplicate feeds, excessive total source bytes, and amplified Neon
write/resident-storage projections. A replacement staging dry run can now include
this estimate to explain rejections. This is NOT a production import guard.

**The dry-run transfer estimate remains optional for backwards compatibility.**
Before enabling execution, make source-derived byte estimates and operator-defined
caps mandatory, measure source query and egress volume, and check free Neon
capacity and WAL/index amplification. Do not equate 500 GB of historical source
data with the amount that needs to be persisted to Neon: prefer source-side
aggregation and incremental watermarks, with deletion/backfill reconciliation.
Never assert that a 500 GB source can fit on a small Neon instance without a
representative canary and verified compact data model. No import is approved
by these planning helpers.

## SQL page-consumption seam (PR #153)

The SQL source adapter now exposes an optional `iterateReportPages()`
async iterable. Each awaited iteration returns only one normalized SQL page;
the caller controls backpressure by requesting the next page only after
processing the previous page. It does not mutate databases or enable an
importer. The legacy `fetchReport()` still aggregates all pages into memory.

**Do not use the current OFFSET pagination as a resumable production
checkpoint.** If source records are inserted, deleted, or updated during an
OFFSET walk, ties on `source_updated_at` and shifting row positions can
skip or duplicate records. The execution integration must use immutable
snapshot isolation or keyset paging with a stable unique tie-breaker and
source-generation-bound cursors, and must update the cursor only after
durable writes. It must also enforce an overall transfer byte ceiling and
apply backpressure across validation and Neon writes.

No evidence of a 500 GB import, production streaming, or cost reduction is
claimed by adding this interface.

## Chronological import and cost constraints

The isolated `consumeCanonicalChronologically` staging helper now enforces
canonical dependency order, with each individual feed traversed by a strict
`(source_updated_at, natural_key)` keyset cursor, a fixed source snapshot
identifier and bounded rows/bytes/pages. It checkpoints only after the caller
has durably committed a page. This is an **opt-in testable seam**, not
the production importer or a source SQL snapshot implementation.

**Chronology has two distinct meanings:** cross-feed dependency ordering is
mandatory; within-feed update ordering governs safe incremental imports.
Business-event chronology (such as `observed_at` or `advanced_at`) must
remain in the rows and be used by time-series reporting, including
retroactive corrections. Globally sorting 500 GB by business date would
force large source sorts and replays and is not required for correctness
when generation isolation, dated upserts and semantic recomputation exist.

Before execution, require actual SQL keyset query implementations with a
stable unique natural-key tie-breaker, indexed source change tokens,
snapshot/CDC consistency, durable idempotent page commits, deletion
reconciliation, and recovery tests. Existing offset-based `fetchReport`
still buffers the full feed and must not be used for massive migrations.
Source-side aggregates and verified change windows should be favoured over
repeated full historical transfer.

## Parameterized SQL keyset plan

`buildCanonicalKeysetQuery` now creates read-only, parameterized SQL for
PostgreSQL, MySQL and SQL Server, ordering each canonical view by
`source_updated_at` and every field of its contracted natural key.
This avoids OFFSET's positional drift and supports bounded page sizes.
SQL identifiers derive only from the trusted canonical schema/format;
runtime values are bound parameters. The planner has no credentials or
connection and cannot execute an import.

**Production gating:** A stable unique tie-breaker, snapshot isolation or
CDC token, timestamp precision agreement across drivers, indexed query plans,
and transactionally idempotent writes/checkpoints must be proven on real
Playground sources. Within-feed ordering uses the last-update timestamp,
while original event/effective dates remain intact for chronological
reporting. The query planner does not by itself guarantee a consistent
snapshot or make production migration safe.

## Source-agnostic canonical mapping foundation

The canonical ten feeds are a DESTINATION contract, not a requirement that an
external database already provides ten `v_*` views. A read-only
`canonicalSchemaMapping` contract now allows an operator-reviewed source
table/view and explicit source-column mapping for each required canonical
field. Every feed must include `source_updated_at`, natural keys, and all
other required fields. Mapping never infers employer/tenant identity or a
business date, never executes arbitrary SQL and never writes to Neon.

This is a staging validation seam, NOT a connected schema-discovery wizard or
a live universal database importer. Today the deployed SQL adapter still
expects canonical views and supports PostgreSQL, MySQL/MariaDB and MSSQL.
Additional engines require separately implemented read-only connectors.
For a large source, prefer a validated indexed view or safe extracted
projection, bounded incremental keyset/CDC reads and source-side aggregation.
Avoid full table replication or blind schema inference. Missing required
business facts must be reported rather than manufactured.

Next: read-only metadata discovery, reviewable mapping preview with sampled
canonical validation, adapter query compilation restricted to allowlisted
source objects, source snapshot consistency, deterministic natural-key
ordering, byte/write caps and Playground ten-feed integration.
