-- TEST-ONLY: a tiny, EMPTY stand-in for the EXISTING ingest_stage source.
-- This file is mounted only by the disposable internal Docker MySQL service.
-- Never run this SQL on AWS RDS; no production source schema is modified.
CREATE DATABASE IF NOT EXISTS ingest_stage
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
USE ingest_stage;

CREATE TABLE employees (
  _ingest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  employee_status VARCHAR(40) NOT NULL,
  source_updated_at TEXT NULL
) ENGINE=InnoDB;

CREATE TABLE debt_accounts (
  _ingest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  debt_balance DECIMAL(12,2) NOT NULL,
  source_updated_at TEXT NULL
) ENGINE=InnoDB;
-- Minimal synthetic stand-in; NOT the deployed source table contract.
CREATE TABLE employers (
  _ingest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  fixture_state VARCHAR(40) NOT NULL,
  source_updated_at TEXT NULL
) ENGINE=InnoDB;

-- Minimal synthetic stand-in; NOT the deployed source table contract.
CREATE TABLE workforce_snapshots (
  _ingest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  fixture_state VARCHAR(40) NOT NULL,
  source_updated_at TEXT NULL
) ENGINE=InnoDB;

-- Minimal synthetic stand-in; NOT the deployed source table contract.
CREATE TABLE platform_users (
  _ingest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  fixture_state VARCHAR(40) NOT NULL,
  source_updated_at TEXT NULL
) ENGINE=InnoDB;

-- Minimal synthetic stand-in; NOT the deployed source table contract.
CREATE TABLE journeys (
  _ingest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  fixture_state VARCHAR(40) NOT NULL,
  source_updated_at TEXT NULL
) ENGINE=InnoDB;

-- Minimal synthetic stand-in; NOT the deployed source table contract.
CREATE TABLE policies (
  _ingest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  fixture_state VARCHAR(40) NOT NULL,
  source_updated_at TEXT NULL
) ENGINE=InnoDB;

-- Minimal synthetic stand-in; NOT the deployed source table contract.
CREATE TABLE ratings (
  _ingest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  fixture_state VARCHAR(40) NOT NULL,
  source_updated_at TEXT NULL
) ENGINE=InnoDB;

-- Minimal synthetic stand-in; NOT the deployed source table contract.
CREATE TABLE referrals (
  _ingest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  fixture_state VARCHAR(40) NOT NULL,
  source_updated_at TEXT NULL
) ENGINE=InnoDB;

-- Minimal synthetic stand-in; NOT the deployed source table contract.
CREATE TABLE salary_advances (
  _ingest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
  fixture_state VARCHAR(40) NOT NULL,
  source_updated_at TEXT NULL
) ENGINE=InnoDB;

-- Deliberately no ON UPDATE: synthetic events demonstrate the real risk
-- of a source mutation that does not advance source_updated_at.
