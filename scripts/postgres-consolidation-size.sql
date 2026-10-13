-- Read-only sizing and migration capacity preflight for the application Postgres.
-- Run against the SOURCE database, never MySQL / SQL Server integrations.
SELECT current_database() AS database_name,
  pg_size_pretty(pg_database_size(current_database())) AS database_size,
  pg_database_size(current_database()) AS database_bytes,
  current_setting('server_version') AS postgres_version;
SELECT schemaname, relname AS table_name,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_total_relation_size(relid) AS total_bytes
FROM pg_catalog.pg_statio_user_tables
ORDER BY pg_total_relation_size(relid) DESC LIMIT 30;
SELECT pg_size_pretty(COALESCE(SUM(pg_total_relation_size(relid)),0)) AS all_user_table_storage
FROM pg_catalog.pg_statio_user_tables;
