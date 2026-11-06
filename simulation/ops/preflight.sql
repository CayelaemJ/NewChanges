-- READ-ONLY. Run with the restricted replication reader after schema approval.
SELECT VERSION() AS mysql_version,@@GLOBAL.log_bin AS log_bin,
       @@GLOBAL.binlog_format AS binlog_format,
       @@GLOBAL.binlog_row_image AS binlog_row_image,
       @@GLOBAL.binlog_row_metadata AS binlog_row_metadata;
SHOW BINARY LOG STATUS;
SHOW BINARY LOGS;
-- RDS read-only inspection: shows retention, which is NOT guaranteed by
-- log_bin=ON. Do not call rds_set_configuration without separate approval.
CALL mysql.rds_show_configuration;

-- Inventory ONLY metadata about the existing ingest_stage schema.
-- TABLE_ROWS is an estimate for InnoDB, not an exact row count.
SELECT TABLE_NAME,TABLE_TYPE,ENGINE,TABLE_ROWS AS estimated_rows,
       ROUND((COALESCE(DATA_LENGTH,0)+COALESCE(INDEX_LENGTH,0))/1048576,2) AS approx_mb
  FROM information_schema.TABLES
 WHERE TABLE_SCHEMA='ingest_stage'
 ORDER BY TABLE_NAME;

-- Metadata-only screening for possible personal/sensitive data.
-- Column names are heuristics, not a legal or privacy classification.
SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA='ingest_stage'
   AND LOWER(COLUMN_NAME) REGEXP
       'email|phone|mobile|address|first.?name|last.?name|birth|passport|identity|national.?id|account|iban|card|secret|token|password|hash'
 ORDER BY TABLE_NAME,ORDINAL_POSITION;

-- Timestamp-column inventory for the existing, non-simulation ingest_stage.
-- Do not overwrite historical dates, blindly add ON UPDATE, or modify these
-- existing tables based solely on their names. This query is metadata-only.
SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,COLUMN_DEFAULT,EXTRA
  FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA='ingest_stage'
   AND LOWER(COLUMN_NAME) REGEXP
       'updated|modified|changed|created|loaded|source_.*(time|date|at)|event_.*(time|date|at)'
 ORDER BY TABLE_NAME,ORDINAL_POSITION;

-- Compare session-local time to the source-of-truth UTC clock.
SELECT CURRENT_TIMESTAMP(6) AS session_time,
       UTC_TIMESTAMP(6) AS utc_time,
       @@SESSION.time_zone AS session_time_zone;

-- After deployment of the entirely separate fixer_sim schema only:
-- SELECT source_table,last_changed_at_utc,
--        TIMESTAMPDIFF(SECOND,last_changed_at_utc,UTC_TIMESTAMP(6))
--          AS seconds_since_last_change
-- FROM fixer_sim.v_source_freshness ORDER BY last_changed_at_utc DESC;

-- Operator can inspect its own grants separately with SHOW GRANTS;
-- redact MySQL account names/hosts before sharing results.

SELECT TABLE_SCHEMA,TABLE_NAME,TABLE_TYPE,ENGINE
 FROM information_schema.TABLES
 WHERE TABLE_SCHEMA NOT IN('mysql','sys','performance_schema','information_schema')
 ORDER BY TABLE_SCHEMA,TABLE_NAME;
SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,DATA_TYPE,COLUMN_KEY,IS_NULLABLE
 FROM information_schema.COLUMNS
 WHERE TABLE_SCHEMA IN('fixer_sim','fixer_sim_analytics')
 ORDER BY TABLE_SCHEMA,TABLE_NAME,ORDINAL_POSITION;
SELECT TABLE_SCHEMA,TABLE_NAME,CONSTRAINT_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME
 FROM information_schema.KEY_COLUMN_USAGE
 WHERE TABLE_SCHEMA='fixer_sim' AND REFERENCED_TABLE_NAME IS NOT NULL;
