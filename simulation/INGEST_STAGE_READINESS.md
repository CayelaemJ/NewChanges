# The Fixer | ingest_stage source readiness (non-destructive)

Status: **read-only discovery implemented**, live schema change/CDC not activated.
Repository branch: `feature/aws-rds-mysql-synthetic-cdc-20261106`.
This document applies to the EXISTING AWS RDS MySQL database, not the
disposable `fixer_sim` schema.

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
