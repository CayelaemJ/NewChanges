-- THE FIXER | AWS RDS MySQL effective CDC retention discovery
-- Explicitly READ-ONLY inspection: call the RDS SHOW configuration procedure.
-- Run manually against the existing RDS MySQL 8.4 endpoint in DBeaver.
-- DO NOT run any rds_set_configuration procedure or execute SQL as a worker.
-- No source rows, PII, credentials, data mutations, replication grants or DDL.
--
-- Result to capture privately: the row named 'binlog retention hours'.
-- NULL means ZERO hours on RDS for MySQL, even if the MySQL engine parameter
-- binlog_expire_logs_seconds reads 2592000 (30 days). These are DIFFERENT
-- settings and cannot be conflated when assessing restart recovery.
-- See https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/mysql-stored-proc-configuring.html

CALL mysql.rds_show_configuration;

-- Independently verify effective runtime server variables.
-- Do not derive the RDS retention window from these values.
SHOW GLOBAL VARIABLES
WHERE Variable_name IN (
  'log_bin', 'binlog_format', 'binlog_row_image',
  'binlog_expire_logs_seconds', 'server_id', 'gtid_mode'
);

-- Index of retained binlog files ONLY: metadata, not row images.
-- If not authorized for this statement, report the privilege failure
-- without granting additional global replication access.
SHOW BINARY LOGS;
