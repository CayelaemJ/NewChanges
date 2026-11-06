-- READ-ONLY. Run with the restricted replication reader after schema approval.
SELECT VERSION() AS mysql_version,@@GLOBAL.log_bin AS log_bin,
       @@GLOBAL.binlog_format AS binlog_format,
       @@GLOBAL.binlog_row_image AS binlog_row_image,
       @@GLOBAL.binlog_row_metadata AS binlog_row_metadata;
SHOW BINARY LOG STATUS;
SHOW BINARY LOGS;
CALL mysql.rds_show_configuration;
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
