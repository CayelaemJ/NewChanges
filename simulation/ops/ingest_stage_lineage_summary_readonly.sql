-- THE FIXER | PRIVACY-SAFE metadata summary of ingest_stage timestamp lineage
-- Read-only, NO source table scans; prints flags rather than SQL view/trigger bodies.
-- Intended for sharing audit summaries without leaking embedded SQL constants.
-- These heuristics are NOT proof that source_updated_at advances on UPDATE.
-- Run on the existing RDS MySQL connection after source metadata audit.

-- A. Every expected canonical feed view, including missing ones.
SELECT expected.feed AS feed,
       IF(v.TABLE_NAME IS NULL, 'MISSING', 'PRESENT') AS view_status,
       CASE
         WHEN v.TABLE_NAME IS NULL THEN 'N/A'
         WHEN v.VIEW_DEFINITION IS NULL THEN 'NOT_VISIBLE'
         WHEN LOCATE('source_updated_at', LOWER(v.VIEW_DEFINITION)) > 0
           THEN 'REFERENCED'
         ELSE 'NOT_REFERENCED'
       END AS source_updated_at_token,
       CASE
         WHEN v.TABLE_NAME IS NULL THEN 'N/A'
         WHEN v.VIEW_DEFINITION IS NULL THEN 'NOT_VISIBLE'
         WHEN LOWER(v.VIEW_DEFINITION) LIKE '%now(%'
           OR LOWER(v.VIEW_DEFINITION) LIKE '%current_timestamp%'
           OR LOWER(v.VIEW_DEFINITION) LIKE '%utc_timestamp%'
           OR LOWER(v.VIEW_DEFINITION) LIKE '%sysdate(%'
           THEN 'POSSIBLE_QUERY_TIME_CLOCK'
         ELSE 'NO_OBVIOUS_CLOCK_TOKEN'
       END AS clock_expression_heuristic
FROM (
    SELECT 'employers' AS feed
    UNION ALL SELECT 'workforce_snapshots'
    UNION ALL SELECT 'employees'
    UNION ALL SELECT 'platform_users'
    UNION ALL SELECT 'journeys'
    UNION ALL SELECT 'debt_accounts'
    UNION ALL SELECT 'policies'
    UNION ALL SELECT 'ratings'
    UNION ALL SELECT 'referrals'
    UNION ALL SELECT 'salary_advances'
) AS expected
LEFT JOIN information_schema.VIEWS AS v
  ON v.TABLE_SCHEMA = 'ingest_stage'
 AND v.TABLE_NAME = CONCAT('v_', expected.feed)
ORDER BY expected.feed;

-- B. Timestamp column metadata ONLY (no column defaults or generated SQL).
SELECT TABLE_NAME AS source_table,
       COLUMN_NAME AS timestamp_column,
       DATA_TYPE AS data_type,
       IS_NULLABLE AS nullable,
       CASE
         WHEN LOWER(EXTRA) LIKE '%on update%' THEN 'ON_UPDATE'
         WHEN LOWER(EXTRA) LIKE '%generated%' THEN 'GENERATED_NOT_AUTOMATICALLY_ADVANCED'
         ELSE 'NO_ON_UPDATE_IN_COLUMN_METADATA'
       END AS column_update_heuristic
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'ingest_stage'
  AND COLUMN_NAME IN (
    'source_updated_at', '_source_updated_utc', 'updated_at',
    'modified_at', 'row_updated_at', 'last_modified_at'
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;

-- C. Only the number/type of triggers; never reveal trigger bodies.
SELECT EVENT_OBJECT_TABLE AS source_table,
       EVENT_MANIPULATION AS trigger_event,
       COUNT(*) AS trigger_count
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = 'ingest_stage'
GROUP BY EVENT_OBJECT_TABLE, EVENT_MANIPULATION
ORDER BY EVENT_OBJECT_TABLE, EVENT_MANIPULATION;

-- D. Indexed watermark and identity columns, no row values.
SELECT TABLE_NAME AS source_table,
       COLUMN_NAME AS indexed_column,
       COUNT(DISTINCT INDEX_NAME) AS index_count,
       MIN(NON_UNIQUE) AS has_unique_or_primary_index
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = 'ingest_stage'
  AND COLUMN_NAME IN (
    '_ingest_id', 'source_updated_at', '_source_updated_utc',
    'updated_at', 'modified_at'
  )
GROUP BY TABLE_NAME, COLUMN_NAME
ORDER BY TABLE_NAME, COLUMN_NAME;
