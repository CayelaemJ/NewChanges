-- DISPOSABLE LOCAL PILOT ONLY. This SQL is mounted solely in the
-- isolated simulation/docker-compose.yml MySQL initialization process.
-- Do NOT execute against the live AWS RDS or ingest_stage schemas.
CREATE DATABASE IF NOT EXISTS fixer_ingest_cdc
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE fixer_ingest_cdc;

CREATE TABLE ingest_checkpoint (
  consumer_name VARCHAR(60) NOT NULL PRIMARY KEY,
  log_file VARCHAR(150) NOT NULL,
  log_pos BIGINT UNSIGNED NOT NULL,
  snapshot_manifest_sha256 CHAR(64) NOT NULL,
  last_plan_digest CHAR(64) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB;

CREATE TABLE ingest_change_markers (
  event_key CHAR(64) NOT NULL PRIMARY KEY,
  feed VARCHAR(40) NOT NULL,
  operation ENUM('INSERT','UPDATE','DELETE') NOT NULL,
  opaque_row_key CHAR(64) NOT NULL,
  source_timestamp_state VARCHAR(42) NOT NULL,
  needs_tombstone BOOLEAN NOT NULL,
  binlog_event_at_utc DATETIME(6) NOT NULL,
  captured_at_utc DATETIME(6) NOT NULL,
  INDEX idx_ingest_feed_capture(feed,captured_at_utc),
  INDEX idx_ingest_row_identity(feed,opaque_row_key)
) ENGINE=InnoDB;

CREATE TABLE ingest_feed_notifications (
  feed VARCHAR(40) NOT NULL PRIMARY KEY,
  generation BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_captured_at_utc DATETIME(6) NOT NULL,
  last_event_key CHAR(64) NOT NULL
) ENGINE=InnoDB;

-- No raw row payload, employee name, account reference, salary, email,
-- or banking details are persisted by this metadata-only prototype.
