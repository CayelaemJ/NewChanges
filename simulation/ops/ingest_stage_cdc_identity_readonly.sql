-- THE FIXER | CDC source-to-view identity preflight (READ ONLY)
-- Metadata only, no source table scans, no SELECT of sensitive records,
-- no output of view definitions or trigger bodies, no grants/DDL/DML.
-- Purpose: check whether canonical reporting views even expose the
-- physical _ingest_id used by the MySQL row-binlog source.
-- WARNING: mere presence does NOT prove correct row identity mapping.
-- If views do not expose it, feed-generation invalidation can still
-- be considered; a selective row fetch needs a separately verified map.

WITH expected AS (
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
)
SELECT
  e.feed,
  IF(v.TABLE_NAME IS NULL, 'MISSING', 'PRESENT') AS view_status,
  IF(base_id.COLUMN_NAME IS NULL, 'NOT_FOUND', 'PRESENT') AS base_ingest_id,
  IF(view_id.COLUMN_NAME IS NULL, 'NOT_EXPOSED', 'EXPOSED') AS view_ingest_id,
  IF(view_watermark.COLUMN_NAME IS NULL, 'MISSING', 'PRESENT') AS view_watermark
FROM expected AS e
LEFT JOIN information_schema.TABLES AS v
  ON v.TABLE_SCHEMA = 'ingest_stage'
 AND v.TABLE_NAME = CONCAT('v_', e.feed)
 AND v.TABLE_TYPE = 'VIEW'
LEFT JOIN information_schema.COLUMNS AS base_id
  ON base_id.TABLE_SCHEMA = 'ingest_stage'
 AND base_id.TABLE_NAME = e.feed
 AND base_id.COLUMN_NAME = '_ingest_id'
LEFT JOIN information_schema.COLUMNS AS view_id
  ON view_id.TABLE_SCHEMA = 'ingest_stage'
 AND view_id.TABLE_NAME = CONCAT('v_', e.feed)
 AND view_id.COLUMN_NAME = '_ingest_id'
LEFT JOIN information_schema.COLUMNS AS view_watermark
  ON view_watermark.TABLE_SCHEMA = 'ingest_stage'
 AND view_watermark.TABLE_NAME = CONCAT('v_', e.feed)
 AND view_watermark.COLUMN_NAME = 'source_updated_at'
ORDER BY e.feed;
