-- OPERATOR-ONLY: run against isolated local MySQL first. Never invoke automatically on existing RDS.
CREATE DATABASE IF NOT EXISTS fixer_sim CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE fixer_sim;
CREATE TABLE IF NOT EXISTS sim_control (
  control_id TINYINT PRIMARY KEY, enabled BOOLEAN NOT NULL DEFAULT FALSE,
  stop_reason VARCHAR(240) NULL, updated_at TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT chk_singleton CHECK (control_id = 1)
) ENGINE=InnoDB;
INSERT INTO sim_control(control_id,enabled) VALUES(1,FALSE) ON DUPLICATE KEY UPDATE control_id=control_id;
CREATE TABLE IF NOT EXISTS simulation_runs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, run_key VARCHAR(128) NOT NULL UNIQUE,
  status ENUM('RUNNING','SUCCEEDED','FAILED') NOT NULL,
  started_at DATETIME(6) NOT NULL, finished_at DATETIME(6) NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  statistics JSON NULL, error_code VARCHAR(100) NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS customers (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, customer_key VARCHAR(96) NOT NULL UNIQUE,
  full_name VARCHAR(140) NOT NULL, email VARCHAR(200) NOT NULL UNIQUE,
  segment ENUM('consumer','business','wholesale') NOT NULL,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE, created_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_customers_updated(updated_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS products (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, sku VARCHAR(96) NOT NULL UNIQUE,
  product_name VARCHAR(150) NOT NULL, price DECIMAL(12,2) NOT NULL,
  inventory INT NOT NULL DEFAULT 0, is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CHECK(price>=0), CHECK(inventory>=0), INDEX idx_products_updated(updated_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS orders (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, order_key VARCHAR(100) NOT NULL UNIQUE,
  customer_id BIGINT NOT NULL, total DECIMAL(12,2) NOT NULL,
  status ENUM('PENDING','PAID','SHIPPED','DELIVERED','CANCELLED') NOT NULL,
  ordered_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_orders_customer FOREIGN KEY (customer_id) REFERENCES customers(id),
  CHECK(total>=0), INDEX idx_order_day(ordered_at), INDEX idx_order_customer(customer_id),
  INDEX idx_orders_updated(updated_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS order_items (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, order_id BIGINT NOT NULL, product_id BIGINT NOT NULL,
  quantity INT NOT NULL, unit_price DECIMAL(12,2) NOT NULL,
  created_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_items_order FOREIGN KEY(order_id) REFERENCES orders(id),
  CONSTRAINT fk_items_product FOREIGN KEY(product_id) REFERENCES products(id),
  CHECK(quantity>0), CHECK(unit_price>=0), INDEX idx_items_order(order_id),
  INDEX idx_items_updated(updated_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS payments (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, payment_key VARCHAR(100) NOT NULL UNIQUE,
  order_id BIGINT NOT NULL, amount DECIMAL(12,2) NOT NULL,
  status ENUM('PENDING','CAPTURED','FAILED','REFUNDED') NOT NULL,
  event_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_payments_order FOREIGN KEY(order_id) REFERENCES orders(id),
  CHECK(amount>=0), INDEX idx_payments_order(order_id), INDEX idx_payments_updated(updated_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS financial_transactions (
  id BIGINT PRIMARY KEY AUTO_INCREMENT, transaction_key VARCHAR(100) NOT NULL UNIQUE,
  payment_id BIGINT NOT NULL, transaction_type ENUM('SALE','REFUND','ADJUSTMENT') NOT NULL,
  amount DECIMAL(12,2) NOT NULL, occurred_at DATETIME(6) NOT NULL,
  updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  CONSTRAINT fk_txn_payment FOREIGN KEY(payment_id) REFERENCES payments(id),
  CHECK(amount>=0), INDEX idx_finance_payment(payment_id),
  INDEX idx_finance_day(occurred_at), INDEX idx_finance_updated(updated_at)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS business_events (
  event_key VARCHAR(150) NOT NULL PRIMARY KEY, operation VARCHAR(30) NOT NULL,
  occurred_at DATETIME(6) NOT NULL, INDEX idx_events_time(occurred_at)
) ENGINE=InnoDB;

-- Times represent UTC when written by the simulation app (session time_zone +00:00).
-- An external SQL client should also SET time_zone='+00:00' before manipulating
-- these DATETIME columns. Defaults/ON UPDATE cover manual SQL changes without
-- requiring application code to remember to set updated_at.
-- The existing ingest_stage schema is never modified by this script.
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_source_freshness AS
 SELECT 'customers' AS source_table, MAX(updated_at) AS last_changed_at_utc FROM customers
 UNION ALL SELECT 'products', MAX(updated_at) FROM products
 UNION ALL SELECT 'orders', MAX(updated_at) FROM orders
 UNION ALL SELECT 'order_items', MAX(updated_at) FROM order_items
 UNION ALL SELECT 'payments', MAX(updated_at) FROM payments
 UNION ALL SELECT 'financial_transactions', MAX(updated_at) FROM financial_transactions
 UNION ALL SELECT 'business_events', MAX(occurred_at) FROM business_events
 UNION ALL SELECT 'simulation_runs', MAX(updated_at) FROM simulation_runs;
