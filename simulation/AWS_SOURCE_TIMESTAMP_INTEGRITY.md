# Source timestamp integrity — AWS ingest_stage

**Status:** design and read-only audit only. No production RDS mutations are authorized by this document.

## Semantics

- `source_updated_at` (currently TEXT): original source-system last-modified timestamp. It is NOT necessarily the MySQL ingest time, and **must not** be fabricated as `NOW()` for existing historical rows.
- `_source_updated_utc` (currently DATETIME): inspect `EXTRA`, `GENERATION_EXPRESSION`, `COLUMN_DEFAULT` and `SHOW CREATE TABLE` before attempting an update. If a generated column, change its defining expression or its source input, never write to it directly.
- `ingested_at_utc` (proposed, not yet present): time that a pipeline received/persisted the row, from the ingestion clock; never label this as source-modified time.
- `cdc_captured_at_utc` (consumer metadata): actual worker capture time; event source timestamp is separate from capture time.
- Distinguish source **event time** from **processing time**. A row corrected later may have a past business date; don't confuse a business effective date with `source_updated_at`.

## Invariants

1. Validate as UTC or convert explicitly from source time zone. Do not blindly interpret local wall clock as UTC.
2. Reject/quarantine new source timestamps that exceed trusted `UTC_TIMESTAMP(6)` by more than a small documented clock-skew tolerance (e.g. 5 minutes); allow small skew only when explicitly measured. **Do not clamp future times to now** because this changes their meaning.
3. Historical future dates: find their origin and use genuine upstream update times if available; otherwise treat as unknown, not current. Keep audit trail of corrections and original values.
4. On genuine *source* UPDATE, source system should advance its actual last-modified timestamp; on replicated changes use ROW/FULL binlog, not unreliable watermark-only polling.
5. Do not run mass UPDATE on AWS solely to 'fix' dummy dates; it increases binlog/storage load, creates misleading history and confuses any downstream consumer. Make migration reversible, backed up, batched, and approved.
6. Never put sensitive source-row values, passwords, employee or financial identifiers into public logs or PR fixtures.

## Read-only metadata checks (DBeaver)

```sql
SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT,
       EXTRA, GENERATION_EXPRESSION
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='ingest_stage'
  AND COLUMN_NAME IN ('source_updated_at','_source_updated_utc')
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

## Read-only anomaly audit (sample counts on one feed)

```sql
SELECT COUNT(*) AS total_rows,
       SUM(source_updated_at IS NULL OR TRIM(source_updated_at) = '') AS missing_source_text,
       SUM(_source_updated_utc IS NULL) AS missing_normalized_utc,
       SUM(_source_updated_utc > UTC_TIMESTAMP() + INTERVAL 5 MINUTE) AS future_normalized_utc,
       SUM(_source_updated_utc > UTC_TIMESTAMP() + INTERVAL 1 DAY) AS far_future_utc
FROM ingest_stage.employees;
```

This runs a table scan; run it off-peak on the test instance and only if query workload permits. Aggregate counts must not be interpreted as historical provenance.

## Before implementation

- Identify the actual source update rules and ingestion code, view definitions and generated-column expressions.
- Choose whether this schema is a landing/staging replica of upstream records or a writer-managed MySQL source: different systems must own `source_updated_at` accordingly.
- Backfill a truthful timestamp only when upstream audit evidence exists. Add ingestion-time and CDC-time separately.
- For genuinely simulated datasets, regenerate controlled fixtures with source timestamps no later than the controlled simulation clock, and mark them as simulated.
