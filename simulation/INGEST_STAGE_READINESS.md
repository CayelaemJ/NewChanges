# The Fixer | ingest_stage source readiness (non-destructive)

Status: **read-only discovery implemented**, live schema change/CDC not activated.
Repository branch: `feature/aws-rds-mysql-synthetic-cdc-20261106`.
This document applies to the EXISTING AWS RDS MySQL database, not the
disposable `fixer_sim` schema.

## Local Docker verification completed (11 November 2026)

The operator provided the full output from
`bash simulation/ops/ci-docker.sh` after fetching commit `5358685a`.
The host phase completed `80 tests` with `9` expected environment skips.
The container phase bootstrapped disposable MySQL 8.4, passed all
`80 tests` with **no errors or skips**, and exited with code **0**.

Verified locally: MySQL SHA-2 auth, ROW/FULL binlog prerequisites,
real simulated binlog read, INSERT/UPDATE/DELETE, durable simulation sink
deduplication and replay, microsecond manual-updated timestamps,
late business-date separation, privacy-safe ingest_stage marker contracts,
transaction planning and checkpoint refusal tests.

**Not yet verified on live RDS:** a working `ingest_stage` binlog consumer,
source snapshot/handoff, global replication-privilege safety, data
classification, configured binlog retention, dedicated durable sink,
or automatic update-time maintenance in existing feed tables.
The local simulation suite passing does **not** authorize deployment.

## Final 91-test Docker verification (12 November 2026)

The operator provided the complete final `bash simulation/ops/ci-docker.sh`
transcript after pulling commit `22d7fd29`. The host phase completed
**91 tests with 16 expected environment-dependent skips**. The test image
built with both `docker-compose.yml` and the local-only
`schema/003_ingest_cdc.sql` fixture, MySQL 8.4 preflight passed,
and the Docker test container completed **91/91 tests, no failures or
skips, exit code 0**.

This verifies locally:
- Actual isolated MySQL binlog event consumption, replay and DELETE handling
  for the separate `fixer_sim` simulation.
- All `ingest_stage` offline marker, privacy, snapshot and transaction contracts.
- Seven new `fixer_ingest_cdc` database integration tests covering
  atomic marker/checkpoint persistence, idempotent replay, rollback on
  duplicate events, stale/uninitialized checkpoints and schema privacy.
- Four local-only safety tests, including packaging of the exact Compose
  mount and rejection of non-disposable execution environments.

**Local Docker verification gate: PASS.** None of these tests establish
an active real `ingest_stage` binlog reader on RDS, a verified snapshot,
configured retention or safe replication privilege scope. No AWS database
or production configuration was changed as part of this test run.

## Explicit XID-gated local stream prototype (12 November 2026)

The `simulation/runtime/ingest_stage_stream.py` module now connects
the existing `ingest_stage` row-event adapter and transaction planner to
the isolated durable `fixer_ingest_cdc` sink. It is **local-Docker only**,
requiring `SIM_ENV=local`, `RUN_LOCAL_MYSQL_TESTS=yes`, the three MySQL
connection hosts set to `mysql`, and matching bootstrap snapshot metadata.
It has no production CLI entrypoint or AWS connection path.

The pilot reads MySQL `WriteRowsEvent`, `UpdateRowsEvent`,
`DeleteRowsEvent` and **`XidEvent`** explicitly from the binlog;
no checkpoint advances before the XID. On commit it durably persists
the opaque event markers and checkpoint together in the existing
transactional sink. Incomplete transactions, invalid event kinds, stale
positions and failed sink commits abort without checkpoint advancement.
XID commits for foreign tables / the sink itself are ignored when no
allowed rows are buffered, preventing self-induced infinite event loops.
Processing is bounded by packet, time and transaction limits.

`simulation/schema/004_ingest_stage_fixture.sql` defines two **empty,
synthetic** source tables `ingest_stage.employees` and
`ingest_stage.debt_accounts` with the same `_ingest_id` primary-key and
nullable TEXT `source_updated_at` shape as the operator-inspected RDS source.
This script is mounted only in the internal, ephemeral Docker MySQL service.
The disposable `sim_writer` receives fixture-only DML, and `sim_repl`
receives fixture SELECT for metadata; the local `sim_cdc` sink account is
unchanged. No AWS or production permissions have been granted.

Added tests:
- Ten host-safe `test_ingest_stage_stream.py` cases: XID-gated commits,
  no checkpoint movement on failure, incomplete/unknown events, correct
  inserts/updates/deletes, binlog rotation, foreign-only XIDs, schema
  isolation, replay checks and refusal outside Docker.
- One `test_ingest_stage_real_binlog.py` Docker test: writes an isolated
  source transaction into the synthetic fixture, uses an actual
  `BinLogStreamReader` including `XidEvent`, then checks atomic marker
  and checkpoint storage and flags an UPDATE with an unchanged source
  timestamp. This test **does not** insert into the real RDS tables.
- Updated the scoped-grant assertion and fixture-copy safety contracts.

**Verification status:** Source files, Docker mounts, local privilege
allowlist and all new test definitions have been statically inspected.
The previous **91/91 Docker pass** predates these changes. The expected
updated suite is **102 tests** (host: 17 environment skips; Docker: no
skips). No Docker daemon is available in the authoring environment, so
the operator's WSL `bash simulation/ops/ci-docker.sh` run is required
before claiming the new MySQL XID integration actually passes.

**Still blocked for live AWS:** genuine consistent snapshot/import manifest,
proven MySQL binlog retention, safe replication privileges on a
mixed-schema instance, actual timestamp/view lineage, full ten-table
live source consumer, restart resilience with real binlog purge/rotation, and app
analytics publication. This local pilot is NOT a deployable
production worker and is deliberately unable to connect to RDS.

## Durable local CDC restart recovery (13 November 2026)

The prior XID-gated local bridge had a repeat-run bug: it required
the durable source checkpoint to equal the **initial** snapshot position,
so a second run after a successful commit could not start.

The local pilot now preserves the original immutable `SnapshotHandoff`
and introduces `load_local_checkpoint` in
`simulation/runtime/ingest_stage_sink.py`. That function performs a fresh
read from the **dedicated disposable sink**, checks the exact snapshot
manifest digest, refuses a missing/malformed position, confirms the stored
coordinate has not regressed or changed binlog lineage, and returns
the saved checkpoint. The `TransactionPlanner` accepts a separate
`resume_checkpoint` only when at or after its original snapshot anchor.
The MySQL reader starts at that sink-verified checkpoint, never at
`SHOW BINARY LOG STATUS` or a wall-clock-derived position.

Tests added/extended:
- Two new offline planner tests for successful resume and rejection of
  backward or foreign-lineage positions.
- One new real disposable-MySQL sink test for positive resume, missing
  consumer, mismatched manifest and corrupted/backward checkpoint.
- The original real XID binlog integration test now runs the reader **twice**
  against two successive synthetic source commits using the same original
  snapshot manifest, and checks that it persists four distinct markers
  without duplicating the first three.

**Verification:** Code and test declarations passed static cross-file checks.
The prior **91/91 Docker result** precedes the XID pilot changes. The new
restart changes bring the expected suite to **105 tests**, all of which
still require WSL/Docker execution before this gate can be marked passed.
There is no enabled background worker or live AWS CDC connection.

## Per-consumer CDC metadata isolation fix (13 November 2026)

Operator WSL output for code commit `2338ad7c`: host phase ran
**105 tests with 18 expected environment skips**; Docker MySQL 8.4
completed **104/105**, with exactly one failed assertion in
`test_atomic_checkpoint_marker_and_replay`. The two-pass XID source
binlog integration test passed. The failing assertion read a shared
`employees` notification and found a newer capture timestamp from
the preceding real-binlog consumer (microseconds `580481`) instead
of its own fixture's `345678`.

**Root cause was real sink-state leakage**, not a timestamp precision
failure: `ingest_feed_notifications` was keyed by `feed` alone.
The `ingest_change_markers` unique identity also lacked a consumer
scope, preventing independent consumers from saving the same source
event. Both local-only tables now use composite primary keys:
`(consumer_name,feed)` for notifications and
`(consumer_name,event_key)` for opaque event markers. The local sink
writer includes `consumer_name` in every insert; all relevant Docker
assertions now filter by consumer. A new disposable-MySQL regression
test saves the **same event key in two consumers** with different
capture timestamps and verifies separate generations, microseconds
and idempotent replay. The failed-transaction regression also asserts
its feed generation stays unchanged after rollback.

**Verification:** Changes were committed and are under static review;
the prior **104/105 run predates this fix**. Expected revised suite:
**106 tests** (host: 19 expected environment skips; Docker: all 106).
The composite-key DDL is ONLY for the fresh tmpfs Docker schema.
No production migration, source table, AWS data or RDS settings were
modified. The test run still needs independent WSL/Docker verification
before this gate can be closed.

## What already exists

The database contains `ingest_stage` with 11 base tables and 10 views,
including the ten canonical views used by `src/services/sourceAdapter.ts`.
`src/services/reportFormats.ts` defines the corresponding ten feed keys,
required columns and `source_updated_at` incremental cursor.

The Fixer's existing MySQL source connector can query read-only `v_*` views
and process canonical feed rows. The current auto-change flow uses bounded
**watermark polling** (default 60 seconds), not an already deployed
`ingest_stage` row-binlog consumer. This distinction must remain clear
in dashboard statuses.

`fixer_sim` and `fixer_sim_analytics` belong to the isolated synthetic
CDC prototype and are not confirmed to exist on the AWS RDS instance.
The existing `simulation/runtime/cdc.py` is fixed to `fixer_sim` tables
with integer `id` keys; **do not point it at `ingest_stage`**. Doing so
would silently assume the wrong data contract and potentially expose
sensitive source records.

## What is implemented now

Execute `simulation/ops/ingest_stage_readonly_audit.sql` in DBeaver
against the existing RDS connection. Its six small, metadata-only
queries check:

1. All ten expected `v_<feed>` views and the required `source_updated_at`.
2. All 59 required canonical field names from `reportFormats.ts`.
3. PK availability and any composite PKs for the 11 base tables.
4. Base-table timestamp columns, defaults and `ON UPDATE` behavior.
5. View definitions that might generate `NOW()` / `UTC_TIMESTAMP()`
   dynamically on read, fabricating apparent changes.
6. Session time-zone relative to UTC.

The script reads only `information_schema` and server clocks. **Do not
paste actual employee, debt, payroll or salary-advance row values into
GitHub or chat.** Metadata results are sufficient.

If the audit reports `MISSING_VIEW`, `MISSING_SOURCE_UPDATED_AT`,
missing required columns, missing PKs or dynamic clocks, resolve the
mapping/DDL design before enabling a live source integration. A view
with `source_updated_at = UTC_TIMESTAMP()` is NOT a valid CDC cursor.

## Confirmed live schema audit (operator, 6 November 2026)

- All **ten** canonical `ingest_stage.v_*` views exist and expose the expected
  **59 required source columns**. No required field names were missing.
- All **eleven** base tables have primary keys. Ten feed tables use `_ingest_id`;
  `import_manifest` uses `dataset`. This does not yet establish the source
  view's natural-key uniqueness or CDC mapping correctness.
- The raw timestamp is **nullable TEXT** `source_updated_at`. The separate
  `_source_updated_utc` is a nullable **VIRTUAL GENERATED** DATETIME derived
  from that source value. The view exposes nullable **DATETIME(0)** as
  `source_updated_at`, with only **one-second precision**.
- None of the reported base source timestamp columns has MySQL
  `ON UPDATE` metadata. View audit did not find a dynamic clock expression;
  this is a heuristic, not evidence that manual UPDATE refreshes the source
  timestamp. Triggers and full view definitions are still unverified.
- SQL session time zone was **UTC** and four read-only metadata audits
  modified no source rows.

**Critical behavior:** Editing an employee, policy, debt or salary row may
**not** advance the view's `MAX(source_updated_at)`. The Fixer's existing
60-second polling loop could therefore miss that edit. Two updates within
the same second can share an identical DATETIME(0) watermark, even if a
source writer explicitly refreshes the timestamp. A hard DELETE also cannot
be detected reliably by this simple max-watermark approach. None of these
risks is solved by faking `source_updated_at = UTC_TIMESTAMP()` in a SELECT.

**Next read-only check:** Execute
`simulation/ops/ingest_stage_timestamp_lineage.sql` in DBeaver. The four
metadata queries inspect exact view SQL, `_source_updated_utc` generated
expressions, triggers (if any), and timestamp/PK indexes. They retrieve
**no employee or financial records** and perform no DDL. Their results
determine whether a new source-maintained modification clock, a separate
CDC event feed, or both are needed.

**Proposed implementation sequence, no live cutover yet:**
1. Establish column lineage and natural-key guarantees without reading
   personal row contents. Confirm where (or whether) source mutation times
   are currently maintained.
2. Build a staging-only read adapter against `ingest_stage.v_*`, using a
   restricted SELECT-only account, verified TLS and canonical schema checks.
3. Implement a separate `ingest_stage` CDC processor for its actual primary
   keys, with a consistent source snapshot, binlog handoff and protected
   Bronze event metadata. Do not repurpose the `fixer_sim` consumer, which
   assumes six unrelated tables and numeric product/order IDs.
4. Design source-side update-time instrumentation only after confirming
   SQL lineage and the effect on existing loads. Any ALTER/TRIGGER or sidecar
   migration requires explicit approval, measured impact and rollback.
5. Verify an approved, isolated test mutation propagates through committed
   CDC -> idempotent sync -> dashboard freshness. Distinguish change time,
   capture time and dashboard publish time.

## Staged CDC event contract implemented (11 November 2026)

The new pure module `simulation/runtime/ingest_stage_contract.py` is
**offline-only**. It does not open MySQL connections, start a replication stream,
write to an analytics database or change production configuration.

It defines a distinct ten-table `ingest_stage` allowlist (excluding
`import_manifest`) and uses the audited source primary key `_ingest_id`,
not the unrelated `fixer_sim.id`. A validated INSERT/UPDATE/DELETE event
produces only an opaque, deterministic event key, an HMAC-protected row token,
an operation, a feed name and timestamps. The raw row, payroll identifiers,
financial balances and other PII do not appear in the resulting marker.
This is a **planning contract**, not a production data-masking guarantee:
the real MySQL replication reader could still see other schemas' row data
because replication privileges are global.

Every marker keeps two clocks separate:
- `binlog_event_at_utc` is the MySQL row-binlog event timestamp at **second
  precision**. It is not a guarantee of the exact commit microsecond.
- `captured_at_utc` is the time a future CDC consumer processes the event;
  it may be later than the actual database mutation.
The actual source's `source_updated_at` must be independently maintained
by its writer or an approved schema change. When an UPDATE leaves that
field unchanged, the contract marks `NOT_ADVANCED_ON_UPDATE` rather than
pretending it is fresh. Hard DELETE emits a tombstone marker.

For **nonempty** existing tables, `validate_snapshot_handoff` rejects a
bootstrap without a consistent and imported source snapshot, a verifiable
manifest digest, an explicit binlog coordinate and positive configured
retention. Passing a Python proof object alone does not establish that the
real-world snapshot was performed. A real consumer still needs a verified,
atomic checkpoint, durable idempotency and crash recovery.

These contract tests are included in the operator's complete **80/80 Docker MySQL 8.4 test pass** on 11 November 2026 (tested commit `5358685a`). The live RDS `ingest_stage` replication integration has **not** been run.

## Atomic ingest_stage transaction planning (11 November 2026)

New files:
- `simulation/runtime/ingest_stage_txn.py`: offline-only transaction planner.
- `simulation/tests/test_ingest_stage_txn.py`: 16 pure tests for transaction
  buffering, binlog rotation, replay, hard-delete tombstones, row limits,
  inconsistent checkpoints and snapshot handoff refusal.
- `simulation/tests/test_ingest_stage_txn_integration.py`: checks integration
  between the `make_change_marker` API and atomic commit planner, using
  fabricated records with private-value sentinels.

The planner consumes **only opaque metadata markers** produced by
`runtime.ingest_stage_contract`. Row payloads (employee, banking, debt and
salary data) must never be copied into the planner or emitted in log output.
It accepts up to 500 marker rows per transaction by default, rejects repeated
event identifiers and regressing binlog coordinates, and understands binlog
file-number rotation within the same lineage.

**Checkpoint safety:** Every planner construction requires the existing
`SnapshotHandoff` contract and a coordinate that matches it. Pending changes
do not advance the checkpoint. `prepare_commit` produces a plan only after
a transaction COMMIT/XID boundary, and the checkpoint stays unchanged until
a future caller confirms that the sink transaction has durably committed the
markers **and checkpoint together**. Abort or an oversized transaction keeps
the previous checkpoint. Merely passing the proof object and calling
`confirm_durable_commit` does not prove external snapshot or sink durability:
a production reader, verified snapshot, real transaction-boundary decoder,
durable sink and atomic checkpoint persistence are **still not implemented**.

The 16 planner tests and the two marker-to-planner integration tests passed
inside the operator's isolated Docker suite (80/80 tests; exit code 0,
11 November 2026). No AWS resource, source record,
replication grant or binlog-retention setting was touched.

## Offline MySQL row-event adapter (11 November 2026)

Added `runtime/ingest_stage_row_adapter.py`. It accepts event objects with
the same shape as MySQL `WriteRowsEvent`, `UpdateRowsEvent` and
`DeleteRowsEvent`, but **does not import or instantiate the network-capable
binlog reader**. It validates the schema and ten-table allowlist through
`make_change_marker`, converts before/after row images into opaque metadata
markers, stages multiple rows at a common packet position with distinct
row indexes, and discards the entire pending transaction on invalid event
kind, malformed row, wrong schema or oversized batch.

The six adapter tests use simulated, locally constructed binlog envelopes.
All of these tests and the real-contract marker/planner integration tests
passed within the operator's 80/80 Docker test run (11 November 2026).
This **is not a demonstrated `ingest_stage` MySQL binlog stream, sink write or dashboard
update**. Both the actual CDC stream worker and durable atomic checkpoint
storage must still be implemented after snapshot, access and retention gates.

Planned event flow, once approved:

```text
MySQL binlog row event (approved ten-table source only)
  -> convert to opaque metadata marker, no raw row persistence
  -> buffer until actual source XID/COMMIT boundary
  -> atomically store markers + source checkpoint in dedicated sink
  -> acknowledge checkpoint only after durable transaction commit
  -> refresh only changed canonical feeds in The Fixer
```

A timestamp precision caveat remains: MySQL row-binlog header time has
second precision, and the future consumer's capture time reflects observation
rather than an exact source modification microsecond. Achieving an exact
manual-edit `source_updated_at` timestamp requires a separate source-write
or approved DDL/trigger solution, after the outstanding live timestamp
lineage query is reviewed.

## Durable local ingest CDC sink added (11 November 2026)

A **separate disposable MySQL schema** `fixer_ingest_cdc` is now initialized
by `simulation/schema/003_ingest_cdc.sql` only when
`simulation/docker-compose.yml` starts its ephemeral MySQL 8.4 container.
The local `sim_cdc` user is granted scoped DML there. This does **not**
install the schema on RDS and it does not alter `ingest_stage` or existing
`fixer_sim_analytics` tables.

`simulation/runtime/ingest_stage_sink.py` adds:
- `bootstrap_local_sink`: requires a valid snapshot handoff and refuses an
  inconsistent existing checkpoint. It has no live production entrypoint.
- `persist_local_plan`: validates a monotonically advancing checkpoint,
  bounded opaque marker tuples, operation/tombstone contracts and digest.
  It locks the expected checkpoint row with `SELECT ... FOR UPDATE` and
  writes markers, one feed notification per changed feed, and the checkpoint
  **in the same InnoDB transaction**, committing together or rolling back.
- Repeating the *identical* last committed plan returns `REPLAYED` without
  inserting new events or incrementing feed generations.
- Only opaque HMAC row identities and change/event timestamps persist. No
  source row image, income, debt, email, payroll or account content is stored.
- This pilot deliberately refuses all non-disposable environments via
  explicit `SIM_ENV`, `RUN_LOCAL_MYSQL_TESTS` and Docker-host checks.

The addition includes seven **real disposable-MySQL integration tests** for
atomic persistence, replay, stale checkpoints, unique-event conflict
rollback, empty transactions, local-only gating and schema privacy,
plus four host-safe guard tests for tampering and local-only initialization.
The updated **91/91 Docker MySQL 8.4 test suite passed on
12 November 2026** (tested code commit `22d7fd29`, exit code 0).
This validates the disposable sink prototype, not live RDS CDC.

**Critical remaining gaps:** a real `ingest_stage` replication reader,
source-side transaction-boundary decoding, safe initial snapshot,
configured RDS binlog retention, privileged binlog exposure review,
production sink provisioning and The Fixer's feed/dashboard notification
integration. Persisting opaque markers alone does not update The Fixer's
canonical records or dashboards. Do not deploy the local sink as a
production CDC service.

## Data and time contract

- A true source mutation timestamp is generated **when a change is committed**.
  It must not be reset to the current time just because a dashboard reads
  the view. A harmless no-op that does not change data must not advance CDC.
- `observed_at`, `created_at`, `advanced_at`, `started_at` and historical
  finance dates retain their business meaning. Do not rewrite them today
  to make old records appear new.
- The SQL source views must map a source-maintained mutation timestamp
  to `source_updated_at` in **UTC**, and modifications to existing records
  must advance this field. This may require a reviewed migration or
  source-side change feed if current tables lack an automatic timestamp.
- `ingest_stage` contains potentially sensitive workforce and financial
  datasets. Its current admin connection has `rds_superuser_role`;
  do not use those credentials for production sync or replication.

## Real CDC and dashboard activation gates

1. Review the metadata audit and confirm the actual primary/foreign keys,
   view aliases, timestamp semantics, data classification and authorized
   synthetic record IDs. Never mutate existing real employee/debt records.
2. Prove a restricted, TLS-validated, **SELECT-only** source adapter against
   the ten `ingest_stage.v_*` views in a staging environment.
   Keep The Fixer's production `IntegrationConfig` and PostgreSQL
   state untouched until verified.
3. Determine initial snapshot boundaries for the existing nonempty source.
   A new binlog checkpoint at "now" without a consistent snapshot
   would drop historical existing data. Hard deletes also require
   tombstones or genuine binlog events.
4. Assess the global read exposure of MySQL replication privileges and
   whether raw Bronze data can contain sensitive customer records.
   No blanket binary-log replica account on this shared instance
   without classification/approval.
5. Configure an agreed MySQL RDS binlog retention/recovery horizon and
   monitor free storage. Operator reported the retention field blank/NULL.
   AWS API read-only inspection found 20 GB allocated and about 17.96 GB
   minimum reported free storage in 6 sampled CloudWatch points over 24h
   on 2026-11-06. This **does not guarantee** a future retention budget.
6. Build, locally test and stage a separate `ingest_stage` CDC processor
   using verified PKs, allowlisted tables, checkpoint/snapshot handoff,
   protected Bronze storage and explicit mapped dashboard targets.
7. Only after approved synthetic scope and staging gates, run bounded
   mutation trials with a unique `SIM-` namespace and true update times.
   No automatic destructive changes or broad UPDATE on live data.

**No production resources or `ingest_stage` rows have been modified.**
