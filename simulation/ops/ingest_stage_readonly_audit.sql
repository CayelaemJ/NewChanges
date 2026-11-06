-- THE FIXER / ingest_stage source compatibility inventory
-- READ-ONLY, METADATA-ONLY. Safe in DBeaver against the existing AWS RDS.
-- Does not touch source rows, set credentials, add timestamps, create users,
-- create tables, change binlog settings, or enable any CDC consumer.
-- Generated against src/services/reportFormats.ts on 2026-11-06.
-- `source_updated_at` MUST reflect actual source mutation, not query time.

-- 1. Expected ten canonical views and their incremental-cursor column.
WITH expected_feeds AS (
  SELECT 'employers' AS feed
  UNION ALL
  SELECT 'workforce_snapshots' AS feed
  UNION ALL
  SELECT 'employees' AS feed
  UNION ALL
  SELECT 'platform_users' AS feed
  UNION ALL
  SELECT 'journeys' AS feed
  UNION ALL
  SELECT 'debt_accounts' AS feed
  UNION ALL
  SELECT 'policies' AS feed
  UNION ALL
  SELECT 'ratings' AS feed
  UNION ALL
  SELECT 'referrals' AS feed
  UNION ALL
  SELECT 'salary_advances' AS feed
)
SELECT e.feed, CONCAT('v_',e.feed) AS expected_view,
  CASE WHEN t.TABLE_NAME IS NULL THEN 'MISSING_VIEW'
       WHEN t.TABLE_TYPE<>'VIEW' THEN 'NOT_A_VIEW'
       WHEN c.COLUMN_NAME IS NULL THEN 'MISSING_SOURCE_UPDATED_AT'
       WHEN c.DATA_TYPE NOT IN ('datetime','timestamp','varchar','char') THEN 'REVIEW_WATERMARK_TYPE'
       ELSE 'VIEW_PRESENT_REVIEW_TIMESTAMP_SEMANTICS'
  END AS readiness_status,
  c.DATA_TYPE AS source_updated_at_type,
  c.DATETIME_PRECISION AS timestamp_precision,
  c.IS_NULLABLE AS watermark_nullable
FROM expected_feeds e
LEFT JOIN information_schema.TABLES t
  ON t.TABLE_SCHEMA='ingest_stage'
 AND t.TABLE_NAME=CONCAT('v_',e.feed)
LEFT JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA='ingest_stage'
 AND c.TABLE_NAME=CONCAT('v_',e.feed)
 AND c.COLUMN_NAME='source_updated_at'
ORDER BY e.feed;

-- 2. Missing required canonical columns (empty result = no missing names).
-- Required field names are derived from reportFormats.ts, not inferred
-- from current raw table names. View expressions/types still need validation.
WITH required_columns AS (
  SELECT 'employers' AS feed, 'employer_ref' AS column_name
  UNION ALL SELECT 'employers' AS feed, 'name' AS column_name
  UNION ALL SELECT 'employers' AS feed, 'source_updated_at' AS column_name
  UNION ALL SELECT 'workforce_snapshots' AS feed, 'employer_ref' AS column_name
  UNION ALL SELECT 'workforce_snapshots' AS feed, 'as_of_date' AS column_name
  UNION ALL SELECT 'workforce_snapshots' AS feed, 'eligible_count' AS column_name
  UNION ALL SELECT 'workforce_snapshots' AS feed, 'source_updated_at' AS column_name
  UNION ALL SELECT 'employees' AS feed, 'employer_ref' AS column_name
  UNION ALL SELECT 'employees' AS feed, 'payroll_ref' AS column_name
  UNION ALL SELECT 'employees' AS feed, 'observed_at' AS column_name
  UNION ALL SELECT 'employees' AS feed, 'eligible_from' AS column_name
  UNION ALL SELECT 'employees' AS feed, 'source_updated_at' AS column_name
  UNION ALL SELECT 'platform_users' AS feed, 'employer_ref' AS column_name
  UNION ALL SELECT 'platform_users' AS feed, 'payroll_ref' AS column_name
  UNION ALL SELECT 'platform_users' AS feed, 'enrolled_at' AS column_name
  UNION ALL SELECT 'platform_users' AS feed, 'source_updated_at' AS column_name
  UNION ALL SELECT 'journeys' AS feed, 'journey_ref' AS column_name
  UNION ALL SELECT 'journeys' AS feed, 'employer_ref' AS column_name
  UNION ALL SELECT 'journeys' AS feed, 'payroll_ref' AS column_name
  UNION ALL SELECT 'journeys' AS feed, 'type' AS column_name
  UNION ALL SELECT 'journeys' AS feed, 'status' AS column_name
  UNION ALL SELECT 'journeys' AS feed, 'started_at' AS column_name
  UNION ALL SELECT 'journeys' AS feed, 'source_updated_at' AS column_name
  UNION ALL SELECT 'debt_accounts' AS feed, 'account_ref' AS column_name
  UNION ALL SELECT 'debt_accounts' AS feed, 'employer_ref' AS column_name
  UNION ALL SELECT 'debt_accounts' AS feed, 'payroll_ref' AS column_name
  UNION ALL SELECT 'debt_accounts' AS feed, 'observed_at' AS column_name
  UNION ALL SELECT 'debt_accounts' AS feed, 'creditor_name' AS column_name
  UNION ALL SELECT 'debt_accounts' AS feed, 'credit_type' AS column_name
  UNION ALL SELECT 'debt_accounts' AS feed, 'balance_rand' AS column_name
  UNION ALL SELECT 'debt_accounts' AS feed, 'in_arrears' AS column_name
  UNION ALL SELECT 'debt_accounts' AS feed, 'source_updated_at' AS column_name
  UNION ALL SELECT 'policies' AS feed, 'policy_ref' AS column_name
  UNION ALL SELECT 'policies' AS feed, 'employer_ref' AS column_name
  UNION ALL SELECT 'policies' AS feed, 'payroll_ref' AS column_name
  UNION ALL SELECT 'policies' AS feed, 'observed_at' AS column_name
  UNION ALL SELECT 'policies' AS feed, 'type' AS column_name
  UNION ALL SELECT 'policies' AS feed, 'premium_rand' AS column_name
  UNION ALL SELECT 'policies' AS feed, 'is_wasteful' AS column_name
  UNION ALL SELECT 'policies' AS feed, 'source_updated_at' AS column_name
  UNION ALL SELECT 'ratings' AS feed, 'rating_ref' AS column_name
  UNION ALL SELECT 'ratings' AS feed, 'employer_ref' AS column_name
  UNION ALL SELECT 'ratings' AS feed, 'payroll_ref' AS column_name
  UNION ALL SELECT 'ratings' AS feed, 'stars' AS column_name
  UNION ALL SELECT 'ratings' AS feed, 'created_at' AS column_name
  UNION ALL SELECT 'ratings' AS feed, 'source_updated_at' AS column_name
  UNION ALL SELECT 'referrals' AS feed, 'referral_ref' AS column_name
  UNION ALL SELECT 'referrals' AS feed, 'employer_ref' AS column_name
  UNION ALL SELECT 'referrals' AS feed, 'payroll_ref' AS column_name
  UNION ALL SELECT 'referrals' AS feed, 'shared_at' AS column_name
  UNION ALL SELECT 'referrals' AS feed, 'source_updated_at' AS column_name
  UNION ALL SELECT 'salary_advances' AS feed, 'salary_advance_id' AS column_name
  UNION ALL SELECT 'salary_advances' AS feed, 'employer_ref' AS column_name
  UNION ALL SELECT 'salary_advances' AS feed, 'client_id' AS column_name
  UNION ALL SELECT 'salary_advances' AS feed, 'payroll_ref' AS column_name
  UNION ALL SELECT 'salary_advances' AS feed, 'amount' AS column_name
  UNION ALL SELECT 'salary_advances' AS feed, 'salary_advance_status' AS column_name
  UNION ALL SELECT 'salary_advances' AS feed, 'advanced_at' AS column_name
  UNION ALL SELECT 'salary_advances' AS feed, 'source_updated_at' AS column_name
)
SELECT r.feed, CONCAT('v_',r.feed) AS source_view,
       r.column_name AS missing_required_column
FROM required_columns r
LEFT JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA='ingest_stage'
 AND c.TABLE_NAME=CONCAT('v_',r.feed)
 AND c.COLUMN_NAME=r.column_name
WHERE c.COLUMN_NAME IS NULL
ORDER BY r.feed,r.column_name;

-- 3. Base-table primary keys. Missing PKs block lossless CDC row identity
-- and need an approved design, not fabricated positional keys.
SELECT t.TABLE_NAME, COALESCE(GROUP_CONCAT(k.COLUMN_NAME
          ORDER BY k.ORDINAL_POSITION SEPARATOR ','),'') AS primary_key_columns,
       CASE WHEN COUNT(k.COLUMN_NAME)=0 THEN 'MISSING_PRIMARY_KEY'
            ELSE 'HAS_PRIMARY_KEY' END AS row_identity_status
FROM information_schema.TABLES t
LEFT JOIN information_schema.KEY_COLUMN_USAGE k
  ON k.TABLE_SCHEMA=t.TABLE_SCHEMA AND k.TABLE_NAME=t.TABLE_NAME
 AND k.CONSTRAINT_NAME='PRIMARY'
WHERE t.TABLE_SCHEMA='ingest_stage' AND t.TABLE_TYPE='BASE TABLE'
GROUP BY t.TABLE_NAME
ORDER BY t.TABLE_NAME;

-- 4. Base-table modification timestamps. 'ON UPDATE' is meaningful
-- only when a value changes; CDC detects row-binlog changes independently.
SELECT t.TABLE_NAME,c.COLUMN_NAME,c.DATA_TYPE,c.IS_NULLABLE,
       c.COLUMN_DEFAULT,c.EXTRA
FROM information_schema.TABLES t
JOIN information_schema.COLUMNS c
  ON c.TABLE_SCHEMA=t.TABLE_SCHEMA AND c.TABLE_NAME=t.TABLE_NAME
WHERE t.TABLE_SCHEMA='ingest_stage' AND t.TABLE_TYPE='BASE TABLE'
 AND (
   LOWER(c.COLUMN_NAME) LIKE '%updated%'
   OR LOWER(c.COLUMN_NAME) LIKE '%modified%'
   OR LOWER(c.COLUMN_NAME) LIKE '%changed%'
   OR LOWER(c.COLUMN_NAME) LIKE '%created%'
   OR LOWER(c.COLUMN_NAME) LIKE '%loaded%'
   OR LOWER(c.COLUMN_NAME) LIKE '%ingested%'
 )
ORDER BY t.TABLE_NAME,c.ORDINAL_POSITION;

-- 5. Flag views that may synthesize a CURRENT clock on SELECT.
-- Such views can appear to change when source rows have not changed.
-- This is a heuristic requiring manual validation, not an approval.
SELECT v.TABLE_NAME,
 CASE WHEN v.VIEW_DEFINITION IS NULL THEN 'DEFINITION_NOT_VISIBLE'
      WHEN LOWER(v.VIEW_DEFINITION) LIKE '%current_timestamp%'
        OR LOWER(v.VIEW_DEFINITION) LIKE '%utc_timestamp%'
        OR LOWER(v.VIEW_DEFINITION) LIKE '%now(%'
        OR LOWER(v.VIEW_DEFINITION) LIKE '%sysdate(%'
      THEN 'REVIEW_DYNAMIC_CLOCK'
      ELSE 'NO_OBVIOUS_DYNAMIC_CLOCK'
 END AS source_updated_at_semantics_review
FROM information_schema.VIEWS v
WHERE v.TABLE_SCHEMA='ingest_stage' AND v.TABLE_NAME LIKE 'v\\_%'
ORDER BY v.TABLE_NAME;

-- 6. Time zones only, no modifications.
SELECT @@SESSION.time_zone AS session_timezone,
       CURRENT_TIMESTAMP(6) AS session_time,
       UTC_TIMESTAMP(6) AS utc_time;
