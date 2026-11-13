-- THE FIXER / ingest_stage exact source timestamp lineage
-- Read-only metadata inspection after the successful ten-feed compatibility audit.
-- Run against the existing AWS RDS MySQL 8.4 connection in DBeaver.
-- No source row scans, no INSERT/UPDATE/DELETE, no DDL or privilege changes.
-- Output contains SQL definitions but no actual row values.
-- Review any embedded constants before sharing view/trigger definitions.

-- 1. Inspect the full SQL that defines the ten canonical feed views.
-- Verify that source_updated_at comes from the source record's change time,
-- not a view-execution clock or unrelated business event date.
SELECT TABLE_NAME AS source_view,
       VIEW_DEFINITION AS view_sql,
       SECURITY_TYPE AS view_security
FROM information_schema.VIEWS
WHERE TABLE_SCHEMA='ingest_stage'
  AND TABLE_NAME IN (
    'v_employers','v_workforce_snapshots','v_employees','v_platform_users',
    'v_journeys','v_debt_accounts','v_policies','v_ratings',
    'v_referrals','v_salary_advances'
  )
ORDER BY TABLE_NAME;

-- 2. Inspect the raw TEXT column and generated UTC expression precisely.
-- A VIRTUAL GENERATED datetime is computed from its source text and cannot
-- update independently when an unrelated field changes.
SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,DATETIME_PRECISION,IS_NULLABLE,
       COLUMN_DEFAULT,EXTRA,GENERATION_EXPRESSION
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA='ingest_stage'
  AND COLUMN_NAME IN (
    'source_updated_at','_source_updated_utc','updated_at',
    'modified_at','row_updated_at','last_modified_at'
  )
ORDER BY TABLE_NAME,ORDINAL_POSITION;

-- 3. Inspect any triggers that may already maintain audit time on writes.
-- A missing ON UPDATE is not definitive if an existing trigger maintains
-- source_updated_at. This returns trigger definitions, not data rows.
SELECT EVENT_OBJECT_TABLE AS source_table,
       TRIGGER_NAME,EVENT_MANIPULATION,ACTION_TIMING,ACTION_STATEMENT
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA='ingest_stage'
ORDER BY EVENT_OBJECT_TABLE,EVENT_MANIPULATION,ACTION_TIMING;

-- 4. Determine whether MySQL can use an index for timestamp watermarks
-- and whether _ingest_id is indexed as a stable row-binlog identity.
SELECT TABLE_NAME,INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,
       INDEX_TYPE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA='ingest_stage'
  AND COLUMN_NAME IN (
    '_ingest_id','source_updated_at','_source_updated_utc',
    'updated_at','modified_at'
  )
ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;
