-- Aiven free migration verification (read-only)
-- Run with psql using a secure session; never paste credentials into this file.
-- Source: Neon PostgreSQL 18; target: Aiven PostgreSQL 17.
--
-- Source/target: run each query independently and compare the results.
SELECT current_database() AS database_name,
       current_setting('server_version') AS version,
       pg_database_size(current_database()) AS database_bytes;
SELECT count(*) AS public_table_count
FROM pg_tables WHERE schemaname = 'public';
SELECT extname, extversion FROM pg_extension ORDER BY extname;
SELECT schemaname, tablename,
       pg_total_relation_size(format('%I.%I',schemaname,tablename)) AS total_bytes
FROM pg_tables WHERE schemaname = 'public'
ORDER BY total_bytes DESC LIMIT 20;
-- DO NOT execute pg_restore until the PostgreSQL 18 to 17 compatibility
-- proof, extension audit and encrypted backup are complete.
