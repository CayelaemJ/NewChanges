-- DISPOSABLE LOCAL MYSQL ONLY. NEVER EXECUTE ON AWS RDS.
-- This isolated schema is separate from ingest_stage and reporting views.
-- Container setup may apply this to a disposable Docker MySQL instance.
CREATE DATABASE IF NOT EXISTS cdc_disposable_fixture;
CREATE TABLE IF NOT EXISTS cdc_disposable_fixture.employers (
    _ingest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
    fixture_state VARCHAR(40) NOT NULL,
    source_updated_at TEXT NULL
) ENGINE=InnoDB;
-- No automatic timestamp update, on purpose; validates binlog-driven refresh.
