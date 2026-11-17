-- The Fixer / PR237: CDC METADATA ONLY. Review and apply via normal
-- PostgreSQL migration process; do not run automatically on application startup.
-- No canonical source rows, payloads or source primary keys are stored here.
-- Deployment requires an independently approved initial baseline.
CREATE TABLE IF NOT EXISTS fixer_cdc_source_state (
  source_id varchar(128) PRIMARY KEY,
  binlog_file varchar(128) NOT NULL,
  binlog_position bigint NOT NULL CHECK (binlog_position >= 4),
  baseline_fingerprint char(64) NOT NULL,
  lease_owner varchar(128),
  lease_until timestamptz,
  lease_fence bigint NOT NULL DEFAULT 0 CHECK (lease_fence >= 0),
  last_committed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixer_cdc_file_safe CHECK (binlog_file ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'),
  CONSTRAINT fixer_cdc_fingerprint_safe CHECK (baseline_fingerprint ~ '^[0-9a-f]{64}$')
);
CREATE TABLE IF NOT EXISTS fixer_cdc_feed_generation (
  source_id varchar(128) NOT NULL REFERENCES fixer_cdc_source_state(source_id) ON DELETE RESTRICT,
  feed varchar(64) NOT NULL CHECK (feed IN (
    'employers','workforce_snapshots','employees','platform_users','journeys',
    'debt_accounts','policies','ratings','referrals','salary_advances'
  )),
  generation bigint NOT NULL DEFAULT 0 CHECK (generation >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_id,feed)
);
-- Application runtime reader: SELECT only. CDC worker: SELECT, INSERT, UPDATE,
-- but no DELETE or DDL; grant these separately to reviewed least-privilege roles.
-- Never use RDS MySQL credentials or replicate the reporting tables here.
