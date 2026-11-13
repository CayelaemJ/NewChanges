-- OPERATOR-ONLY: no existing application schema modifications.
CREATE DATABASE IF NOT EXISTS fixer_sim_analytics CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE fixer_sim_analytics;
CREATE TABLE IF NOT EXISTS cdc_checkpoint (
  consumer_name VARCHAR(60) PRIMARY KEY,
  log_file VARCHAR(250) NOT NULL, log_pos BIGINT UNSIGNED NOT NULL,
  updated_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS bronze_changes (
  event_key CHAR(64) PRIMARY KEY, source_file VARCHAR(250) NOT NULL,
  source_pos BIGINT UNSIGNED NOT NULL, row_index INT NOT NULL,
  entity VARCHAR(30) NOT NULL, operation ENUM('INSERT','UPDATE','DELETE') NOT NULL,
  entity_id BIGINT NOT NULL, old_payload JSON NULL, new_payload JSON NULL,
  event_at DATETIME(6) NOT NULL, received_at DATETIME(6) NOT NULL,
  INDEX idx_bronze_received(received_at), INDEX idx_bronze_entity(entity,entity_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS silver_entity_state (
  entity VARCHAR(30) NOT NULL, entity_id BIGINT NOT NULL,
  payload JSON NULL, is_deleted BOOLEAN NOT NULL,
  last_event_key CHAR(64) NOT NULL, updated_at DATETIME(6) NOT NULL,
  PRIMARY KEY(entity,entity_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS silver_orders (
  order_id BIGINT PRIMARY KEY, customer_id BIGINT NOT NULL,
  total DECIMAL(12,2) NOT NULL, status VARCHAR(20) NOT NULL,
  ordered_at DATETIME(6) NOT NULL, is_deleted BOOLEAN NOT NULL,
  INDEX idx_silver_order_day(ordered_at), INDEX idx_silver_customer(customer_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS silver_payments (
  payment_id BIGINT PRIMARY KEY, order_id BIGINT NOT NULL,
  amount DECIMAL(12,2) NOT NULL, status VARCHAR(20) NOT NULL,
  is_deleted BOOLEAN NOT NULL, INDEX idx_silver_payments_order(order_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS silver_transactions (
  transaction_id BIGINT PRIMARY KEY, payment_id BIGINT NOT NULL,
  transaction_type VARCHAR(20) NOT NULL, amount DECIMAL(12,2) NOT NULL,
  occurred_at DATETIME(6) NOT NULL, is_deleted BOOLEAN NOT NULL,
  INDEX idx_silver_txn_day(occurred_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS gold_daily_transactions (
  transaction_day DATE PRIMARY KEY, transaction_count BIGINT NOT NULL,
  net_amount DECIMAL(18,2) NOT NULL, recorded_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS gold_daily_sales (
  order_day DATE PRIMARY KEY,
  order_count BIGINT NOT NULL DEFAULT 0, cancelled_count BIGINT NOT NULL DEFAULT 0,
  gross_sales DECIMAL(18,2) NOT NULL DEFAULT 0,
  net_payments DECIMAL(18,2) NOT NULL DEFAULT 0,
  recorded_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS gold_customer_activity (
  customer_id BIGINT PRIMARY KEY, order_count BIGINT NOT NULL DEFAULT 0,
  lifetime_order_value DECIMAL(18,2) NOT NULL DEFAULT 0,
  recorded_at DATETIME(6) NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS cdc_worker_runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, started_at DATETIME(6) NOT NULL,
  finished_at DATETIME(6) NULL, state ENUM('RUNNING','SUCCEEDED','FAILED') NOT NULL,
  events_processed INT NOT NULL DEFAULT 0, error_type VARCHAR(90) NULL
) ENGINE=InnoDB;
-- Consumers should be granted SELECT only on these views and no base-table writes.
CREATE OR REPLACE VIEW v_daily_sales AS
 SELECT order_day,order_count,cancelled_count,gross_sales,net_payments,recorded_at FROM gold_daily_sales;
CREATE OR REPLACE VIEW v_daily_transactions AS
 SELECT transaction_day,transaction_count,net_amount,recorded_at FROM gold_daily_transactions;
CREATE OR REPLACE VIEW v_customer_activity AS
 SELECT customer_id,order_count,lifetime_order_value,recorded_at FROM gold_customer_activity;
CREATE OR REPLACE VIEW v_cdc_latency AS
 SELECT COUNT(*) AS processed_events,
        TIMESTAMPDIFF(SECOND,MAX(event_at),UTC_TIMESTAMP(6)) AS last_event_age_seconds,
        MAX(received_at) AS last_received_at FROM bronze_changes;
CREATE OR REPLACE VIEW v_cdc_worker_runs AS
 SELECT id,started_at,finished_at,state,events_processed,error_type FROM cdc_worker_runs;
CREATE OR REPLACE VIEW v_pipeline_quality AS
 SELECT COUNT(*) AS total_runs,
        SUM(state='FAILED') AS failed_runs,
        COALESCE(SUM(events_processed),0) AS rows_processed,
        MAX(CASE WHEN state='SUCCEEDED' THEN finished_at ELSE NULL END) AS last_successful_sync
 FROM cdc_worker_runs;
