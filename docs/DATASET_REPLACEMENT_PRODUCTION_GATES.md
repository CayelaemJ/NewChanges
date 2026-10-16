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

## Bounded source metadata discovery and mapping preview

`canonicalSchemaDiscovery.ts` now plans read-only `information_schema.columns`
queries for MySQL, PostgreSQL and SQL Server. Schema names are bound parameters
and discovery caps at 5,000 column metadata records. The helper validates
mapped source table and field names against a returned catalogue, generates a
review-only field preview, and offers **name-only** suggestions; it does not
infer business meaning, source identity, tenancy, chronology or relationships.
Review outcomes never enable execution or publication.

This is a pure planner, not a working remote-database discovery endpoint.
The next implementation must execute these queries with least-privilege
credentials and a hard timeout, fail when the metadata limit is exceeded,
and provide an authenticated Admin review of selected source objects.
Before data movement, sample-validate mapped fields against canonical
contracts and require explicit approval of tenant identifiers and date
semantics. For sources without the necessary business fields, report gaps
rather than fabricate values.

The legacy SQL adapter still requires canonical views until an approved
mapping is compiled into allowlisted source queries. Source byte, Neon-write,
resident-size and transfer-cost budgets must become mandatory enforcement in
that execution path. Never move hundreds of gigabytes into Neon by default.

## Catalog-verified mapping to bounded SQL extraction (staging only)

`canonicalMappedKeysetSql.ts` now compiles an explicit ten-feed mapping,
already checked against a returned column catalogue, into dialect-specific
read-only SELECT projections for PostgreSQL, MySQL, or SQL Server. It selects
only explicitly mapped canonical columns (no SELECT *), aliases them to the
canonical contract, and uses parameterized upper watermarks and
`(source_updated_at, natural-key)` keyset predicates. Source identifiers must
exist in the discovered catalogue and satisfy strict identifier validation.

This module **does not execute SQL**, authorize a mapping, guarantee a source
snapshot, start a migration, or turn optional estimates into spending controls.
Before live use, implement a least-privilege discovery executor, explicit
operator semantic approvals and sample validation, snapshot-consistent keyset
queries, persistent idempotent checkpoints, real byte/write accounting, and a
bounded staged publisher with tested rollback.

Indexes, non-unique natural keys, collations, null behavior, timestamps,
cross-table joins, and databases whose semantics cannot fit the ten feeds
remain source-specific feasibility checks. If a source requires aggregation
or joining multiple tables, the next approved mapping version will need
controlled transformations or source-side views; it must not silently invent
fields. Do not claim universal engine support beyond the three currently
implemented SQL dialects.

## Metadata truncation safety check (staging)

`validateDiscoveredCatalog` rejects a discovered schema catalogue when it
contains as many columns as the configured cap, since this could be a truncated
result. It also rejects schema mismatches, malformed column metadata, and
duplicate column identities. The intended discovery caller must run this
validation before mapping review and retry with a narrower schema/scope rather
than treating an incomplete inventory as authoritative. No connection or
production ingestion is activated by this helper.

## Executable mapped extraction + durable Playground receipt rehearsal (PR #153)

The staged modules now compose into an **opt-in integration seam**:
`openPlaygroundMysqlSnapshot` opens a TLS-validated, read-only repeatable
MySQL snapshot (hard lifetime 120 seconds and 30-second maximum per-query
timeout), queries `information_schema` with a bounded metadata budget,
`extractMappedFeedToStaging` compiles and executes selected-column keyset
pages after mapping/catalogue checks, and
`createPlaygroundMappedStagingStore` persists each page to content-addressed
files before advancing the associated checkpoint. A simulated mid-feed failure
and restart is covered with a stable synthetic snapshot identifier.

**Important restrictions**:
- The MySQL snapshot adapter and local staging store are NOT wired to the
  production ingestion scheduler, Neon write path, or source activation.
- The consistency proof belongs to one live MySQL transaction. A transaction
  snapshot cannot be recovered after disconnect: the synthetic recovery test
  does not prove cross-session restart correctness with a changing live source.
  Production restart requires CDC, immutable source snapshots, or documented
  idempotent replay from a newly validated source generation.
- The local Playground filesystem uses a single-writer contract, no distributed
  lease, and is not a cloud object-store or production durability guarantee.
  Its checkpoint is atomically published *after* a fsynced page, preventing a
  checkpoint pointing at incomplete bytes. Failed publication leaves harmless
  orphan files requiring bounded cleanup.
- The source mapping and field meanings require operator approval and canonical
  row validation before any production sink. The current executable staging
  runner checks presence and shape of required fields, but not every
  domain-specific canonical field rule.
- Source costs are bounded by row/page and measured JSON bytes AFTER each
  driver query returns. A production executor additionally needs streaming
  driver backpressure and network-byte limits before transfer, query plan
  validation, and storage budget enforcement across all ten feeds.
- We have NOT run ten real mapped source tables end-to-end or proved a 500 GB
  transformation fits on a small Neon instance. No production code cutover.

The next approved migration must connect a durable shared storage backend,
atomic idempotent checkpoint+write transactions, controlled deletions and
reconciliation, semantic publication, and a full Railway Testing rehearsal
before deploying to production.

## Full mapped ten-feed Playground staging rehearsal

The isolated test `tests/ten-canonical-mapped-playground.test.ts` now composes
ten different source-table mappings, bounded SQL query plans, strict canonical
feed dependency order, aggregate row/byte/page reservations, and per-page
durable filesystem checkpoint receipts. It verifies all ten feed checkpoints
after completion and confirms publication stays disabled.

This runs against a deterministic in-memory SQL-session mock, NOT an external
MySQL database. It tests integration contracts, crash handling and local
file durability; it does not demonstrate live source performance or billing.
A real MySQL read-only TLS snapshot adapter is available for an explicitly
approved Playground rehearsal, but the production scheduler never calls it.

**Remaining production blockers**:
1. Authenticated administrator approval of the discovered source schema,
   natural keys, business dates and employer/tenant mappings.
2. Real source-index and snapshot feasibility checks, large-row streaming
   backpressure, transformations/joins, and canonical row validation.
3. Cloud object-storage durability with distributed single-writer fencing,
   retention, cleanup, key-rotation and data governance.
4. Restart-safe CDC/immutable snapshot or revalidated replay; a new MySQL
   transaction is NOT the old consistent snapshot.
5. Transactional batch projection, semantic processing, atomic publication and
   rollback against an isolated Neon testing database.
6. Full ten-feed data reconciliation and measured network, compute, storage,
   security and rollback checks on Railway Testing and supported source types.

No production connection, import or migration was executed by the rehearsal.
