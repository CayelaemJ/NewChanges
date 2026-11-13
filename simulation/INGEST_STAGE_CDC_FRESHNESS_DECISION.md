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
5. Before implementing per-row selective refresh, **prove the row
   identity join** from the ten base tables' `_ingest_id` to the
   canonical views' natural keys. The persisted HMAC marker cannot be
   reversed into a source PK; do not make a targeted SQL query using a
   token as if it were a raw ID. If mapping is not proven, use bounded
   on-demand feed invalidation/requery only, with explicit cost/load
   budgets, rather than a pretend row-level merge.
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
