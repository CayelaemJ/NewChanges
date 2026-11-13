# Architecture decision: ingest_stage CDC freshness without PostgreSQL row replication

**Decision record: 13 November 2026 — local prototype, NOT production activation.**

## Evidence: operator's live read-only RDS metadata results

All ten canonical views (`v_employers`, `v_workforce_snapshots`,
`v_employees`, `v_platform_users`, `v_journeys`,
`v_debt_accounts`, `v_policies`, `v_ratings`,
`v_referrals`, `v_salary_advances`) are **present**.
All ten reference `source_updated_at`, expose a nullable DATETIME
projection, and have **no obvious query-time-clock tokens** in the
metadata summary. Token presence is NOT proof of the column's precise
expression, timezone conversion or last-write semantics.

Each of the ten base tables has a nullable `source_updated_at TEXT`
and a generated nullable `_source_updated_utc DATETIME`. The metadata
reports **no ON UPDATE maintenance** for the source TEXT fields; the
generated UTC field cannot independently advance on an unrelated update.
No rows were returned in the trigger-count section of the operator's
summary (no visible timestamp-maintenance triggers). Every source
`_ingest_id` is indexed with a unique/primary index and
`_source_updated_utc` has an index, but a fast index on an outdated or
missing timestamp is **not a correctness guarantee**.

The live `CALL mysql.rds_show_configuration` returned **NULL** for
`binlog retention hours` (RDS MySQL: zero hours guaranteed). Runtime
logging is `ON`, `ROW`, `FULL`. The operator's isolated local
ten-feed binlog suite passed **107/107** at tested runtime commit
`faac2fb4`; the live RDS CDC consumer has never been enabled.

## Confirmed physical-to-reporting identity gap (operator read-only RDS audit)

The operator ran `simulation/ops/ingest_stage_cdc_identity_readonly.sql`
against the live AWS RDS database. For all ten feed names:

| Check | Operator-verified outcome |
|---|---|
| Canonical `v_*` view | **10/10 PRESENT** |
| Physical source table `_ingest_id` | **10/10 PRESENT** |
| `_ingest_id` in canonical view output | **0/10 EXPOSED** |
| View `source_updated_at` watermark column | **10/10 PRESENT** |

**Decision: feed-level invalidation is the supported first version.**
The physical binlog row's `_ingest_id` cannot be directly queried
from the canonical reporting view because none exposes it.
No source primary key may be inferred, reconstructed from HMAC,
or appended to a canonical report view without an explicit schema,
privacy and identity-contract review.

This does **not** require a schema change. The durable CDC sink already
tracks source table/consumer feed notification generations. An
authorized dashboard component can use generation advances as a
cache-invalidation signal, then query only the affected canonical
MySQL view through a dedicated, approved **read-only** query path.
Coalesce bursts and impose bounded concurrency, maximum query cost,
timeouts, cache TTL and backpressure. Never requery all ten views
automatically for every binlog row event; that would overload the RDS
micro instance. Since physical deletes and updates are indicated by
binlog events, do not infer freshness solely from nullable/stale
`source_updated_at` values.

**Critical application integration detail:** in the existing
`src/services/sourceAdapter.ts`, `createSourceAdapter` exposes a
SQL/MySQL report reader. However,
`src/services/syncService.ts` calls that reader as part of a
**PostgreSQL upsert/import workflow** (including
`prisma.importBatch.create`, bulk natural-key merge and
`prisma.integrationCursor`). The production dashboard invalidation
path must **NOT call the sync service or its existing sync triggers**.
Read-only source-query logic can be factored into an isolated
server-side dashboard service with a dedicated least-privilege
connection, without persisting raw MySQL reporting rows to Postgres.

A small no-IO, offline-only pilot in
`simulation/runtime/ingest_stage_feed_refresh.py` plans
per-feed invalidation based on monotonically increasing generations
and explicit source-read authorization/snapshot gates; it never
queries or writes any database, never consumes raw IDs or source
timestamps, coalesces repeated notifications via query spacing and
refuses to acknowledge a new cache generation until the caller
confirms a successful MySQL read/cache update. This is **not yet**
wired into the application or deployed.

## Decision

1. **MySQL remains authoritative for reporting data.** Never rewrite
   the ten `ingest_stage.v_*` result sets to Railway PostgreSQL as a
   redundant reporting store. Railway PostgreSQL continues to hold
   application-owned state.
2. **Source mutation detection must use committed binlog coordinates
   and explicit XID boundaries**, not `source_updated_at > last_sync`.
   A stale or NULL timestamp must not suppress an actual UPDATE or
   DELETE marker. Keep `source_updated_at` for the existing business
   data contract but label its mutation-time reliability **unverified**.
3. After an authorized and verified initial snapshot, process
   allowlisted `ingest_stage` INSERT/UPDATE/DELETE events and persist
   only source-oblivious HMAC row markers, transaction checkpoints,
   per-feed notification generations and minimal observability in the
   designated metadata sink. **No raw workforce, payroll, debt or
   customer values in the metadata sink, logs or queue.**
4. For dashboards, use the per-feed notification generation as a
   **freshness/invalidation signal**. Query the authoritative canonical
   MySQL views through the existing restricted, TLS-verified, read-only
   source adapter. The source adapter must not silently apply a
   timestamp-based `since` filter to a change-triggered refresh until
   reliable mutation-time semantics have been established.
5. **Use bounded feed-level invalidation first:** the operator's
   live identity preflight proved `_ingest_id` is not exposed by
   any of the ten canonical views. Do not attempt selective row-level
   refresh from a physical binlog ID or reverse a persisted HMAC token.
   Per-row selective refresh requires a separately approved and
   verified natural-key mapping plus a privacy/security review.
6. Hard DELETE must invalidate the relevant feed and retain a metadata
   tombstone. Preserve historic business event dates; do not set
   source timestamps to `NOW()` to make old records appear new.
7. Treat failures as **fail closed**: do not advance a durable
   checkpoint before the metadata transaction commits. If replay
   coordinates have been purged, stop and require a new approved
   consistent snapshot; never start at the newest binlog position to
   mask a gap.
8. Do not grant a global MySQL replication role on the existing
   mixed-schema RDS instance until privacy/classification and least
   privilege are reviewed. Application-side table filters do not
   restrict what the upstream replication account can receive.

## Existing application dashboard route check (13 November 2026)

A read-only repository inspection confirms the current dashboard API
is still **backed by the app's PostgreSQL-derived snapshot pipeline**,
not by live canonical MySQL queries:

- `src/server.ts` loads `getDashboardPayload` and
  `getPublishedDashboardPayload` from
  `src/services/snapshotBuilder.ts` for dashboard payload endpoints,
  including `/api/dashboard/first`.
- `/api/dashboard/events` streams a publication version based on the
  app's `IntegrationConfig.lastSuccessfulSyncAt`, and
  `/api/dashboard/version` reports that sync publication timestamp.
  **A CDC marker must not impersonate a completed dashboard
  publication**: the UI should only announce a new data version after
  the approved MySQL view read and cache replacement succeed.
- The current `src/services/sourceAdapter.ts` MySQL query executor
  supports `source_updated_at > ?` incremental filters. For an
  event-triggered report refresh, **do not pass the prior timestamp
  watermark as `since`**, because live RDS source columns may be
  stale or NULL. Continue to respect existing canonical report
  contract and view authorization.
- `src/services/syncService.ts` owns the existing PostgreSQL
  import/upsert path; **do not invoke its sync triggers** on CDC
  notifications. Otherwise a new binlog consumer would still copy
  reporting data into PostgreSQL.

**Follow-on engineering scope (not yet implemented):** create an
independent, server-side, tenant-authorized and report-allowlisted
**read-only MySQL dashboard adapter** with reviewed query limits and
deduplicated per-feed notification generations. Cache results only
where authorized and within a bounded size/TTL. Integrate with the
existing dashboard version/SSE mechanism *only after* an atomic
successful cache publication. Existing production dashboard endpoints
must remain unchanged until that independently tested path is ready.
No new production endpoint, worker or database privilege is claimed.

## Production activation gates (remain BLOCKED)

- Confirm an acceptable RDS binlog-retention period, estimate binlog
  growth, monitor CloudWatch storage and obtain explicit operator
  approval **before setting retention**. Proposed 24 hours is not yet
  approved or applied.
- Verify the actual view projection and per-row identity mapping,
  sensitive data scope, and restricted MySQL source adapter behavior.
- Establish a consistent initial snapshot and verified import
  manifest for the populated ten-feed source before CDC begins.
- Choose a durable **metadata-only** sink and run restart, rotation,
  replay, privilege, schema-drift and cost/security tests.
- Wire per-feed generation invalidation to The Fixer's dashboard
  refresh logic; test stale/missing timestamps, same-second updates,
  hard deletes and failures with the report SQL reading **MySQL**.
- Explicitly approve RDS connectivity, replication grants, rollout
  and operational alerting. Keep the local fixture's strict
  `SIM_ENV=local` guards; never remove them to enable production.

**No RDS source writes, schema migrations, password rotations, grants,
binlog setting changes, PostgreSQL row replication or production deploys
are part of this decision record.**
