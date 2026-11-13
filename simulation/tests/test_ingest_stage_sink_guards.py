"""Guardrails for metadata-only ingest CDC sink; safe on host without MySQL."""
from dataclasses import replace
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch
import os
import unittest

from runtime.ingest_stage_contract import SnapshotHandoff
from runtime.ingest_stage_txn import LogCoordinate, TransactionPlanner
from runtime.ingest_stage_sink import bootstrap_local_sink, persist_local_plan

ROOT = Path(__file__).resolve().parents[1]


def plan():
    proof = SnapshotHandoff(
        schema="ingest_stage", binlog_file="mysql-bin-changelog.000055",
        binlog_position=500, snapshot_consistent=True,
        snapshot_import_verified=True, snapshot_manifest_sha256="a" * 64,
        retention_hours=24)
    planner = TransactionPlanner(LogCoordinate(proof.binlog_file, 500),
                                 handoff=proof)
    planner.begin()
    return proof, planner.prepare_commit(LogCoordinate(proof.binlog_file, 600))


class IngestSinkSafetyContracts(unittest.TestCase):
    def test_external_context_rejected_before_touching_db(self):
        db = Mock()
        handoff, committed = plan()
        with patch.dict(os.environ, {
            "SIM_ENV": "production", "RUN_LOCAL_MYSQL_TESTS": "yes",
            "SIM_DB_HOST": "aws-rds", "SIM_CDC_HOST": "aws-rds",
        }):
            with self.assertRaises(RuntimeError):
                bootstrap_local_sink(db, handoff)
            with self.assertRaises(RuntimeError):
                persist_local_plan(db, committed)
        db.begin.assert_not_called()

    def test_tampered_checksum_fails_before_db_transaction(self):
        db = Mock()
        _, committed = plan()
        with patch.dict(os.environ, {
            "SIM_ENV": "local", "RUN_LOCAL_MYSQL_TESTS": "yes",
            "SIM_DB_HOST": "mysql", "SIM_CDC_HOST": "mysql",
        }):
            with self.assertRaises(ValueError):
                persist_local_plan(db, replace(committed, digest="b" * 64))
        db.begin.assert_not_called()

    def test_raw_payload_objects_rejected_before_db_transaction(self):
        db = Mock()
        _, committed = plan()
        # A crafted digest can still be syntactically correct. Never trust
        # arbitrary data structures masquerading as privacy-safe markers.
        fake = replace(committed, changes=({"salary": "PRIVATE"},))
        with patch.dict(os.environ, {
            "SIM_ENV": "local", "RUN_LOCAL_MYSQL_TESTS": "yes",
            "SIM_DB_HOST": "mysql", "SIM_CDC_HOST": "mysql",
        }):
            with self.assertRaises(ValueError):
                persist_local_plan(db, fake)
        db.begin.assert_not_called()

    def test_ddl_only_mounted_in_disposable_mysql(self):
        ddl=(ROOT / "schema" / "003_ingest_cdc.sql").read_text(encoding="utf-8")
        compose=(ROOT / "docker-compose.yml").read_text(encoding="utf-8")
        dockerfile=(ROOT / "Dockerfile.test").read_text(encoding="utf-8")
        self.assertIn("CREATE DATABASE IF NOT EXISTS fixer_ingest_cdc",ddl)
        self.assertIn("CREATE TABLE ingest_checkpoint",ddl)
        self.assertIn("CREATE TABLE ingest_change_markers",ddl)
        self.assertIn("CREATE TABLE ingest_feed_notifications",ddl)
        # Cross-consumer notifications and change identities must be isolated.
        self.assertIn("PRIMARY KEY (consumer_name,event_key)", ddl)
        self.assertIn("PRIMARY KEY (consumer_name,feed)", ddl)
        self.assertNotIn("USE ingest_stage",ddl)
        self.assertNotIn("ALTER TABLE ingest_stage",ddl)
        self.assertIn("03-ingest-cdc.sql:ro",compose)
        # Keep all referenced safety-fixture files in the test image.
        # Prevent another host-green/container-FileNotFoundError regression.
        self.assertIn("04-ingest-stage-fixture.sql:ro", compose)
        fixture=(ROOT / "schema" / "004_ingest_stage_fixture.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE DATABASE IF NOT EXISTS ingest_stage", fixture)
        self.assertIn("_ingest_id BIGINT UNSIGNED NOT NULL PRIMARY KEY", fixture)
        self.assertIn("source_updated_at TEXT NULL", fixture)
        self.assertNotIn("AWS_HOST", fixture)
        self.assertIn("COPY schema/004_ingest_stage_fixture.sql schema/004_ingest_stage_fixture.sql",
                      dockerfile)
        self.assertIn("COPY docker-compose.yml docker-compose.yml", dockerfile)
        self.assertIn("COPY schema/003_ingest_cdc.sql schema/003_ingest_cdc.sql",
                      dockerfile)


if __name__ == "__main__":
    unittest.main()
