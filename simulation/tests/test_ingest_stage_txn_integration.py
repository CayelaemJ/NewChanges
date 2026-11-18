"""Offline integration between actual ingest_stage marker and transaction contracts."""
from datetime import datetime, timezone
import unittest

from runtime.ingest_stage_contract import (
    SnapshotHandoff, make_change_marker,
)
from runtime.ingest_stage_txn import (
    LogCoordinate, TransactionPlanner,
)


class SourceMarkerCheckpointIntegration(unittest.TestCase):
    def test_stale_source_timestamp_and_delete_stay_in_atomic_commit_plan(self):
        checkpoint = LogCoordinate("mysql-bin-changelog.000055", 500)
        proof = SnapshotHandoff(
            schema="ingest_stage", binlog_file=checkpoint.file,
            binlog_position=checkpoint.position,
            snapshot_consistent=True, snapshot_import_verified=True,
            snapshot_manifest_sha256="b" * 64, retention_hours=24,
        )
        planner = TransactionPlanner(checkpoint, handoff=proof)
        captured_at = datetime(2026, 11, 11, 9, 10, 0, 987654, tzinfo=timezone.utc)
        private_source = {
            "_ingest_id": 42,
            "payroll_ref": "PRIVATE_PAYROLL_TOKEN",
            "source_updated_at": "2025-03-01T10:00:00Z",
            "salary": "PRIVATE_SALARY",
        }
        edited = private_source | {"salary": "OTHER_PRIVATE_SALARY"}
        updated = make_change_marker(
            schema="ingest_stage", table="employees",
            operation="UPDATE", old=private_source, new=edited,
            binlog_file=checkpoint.file, binlog_position=545, row_index=0,
            binlog_timestamp=1794391200, hmac_secret=b"X" * 32,
            captured_at_utc=captured_at,
        )
        deleted = make_change_marker(
            schema="ingest_stage", table="employees",
            operation="DELETE", old=edited, new=None,
            binlog_file=checkpoint.file, binlog_position=575, row_index=0,
            binlog_timestamp=1794391200, hmac_secret=b"X" * 32,
            captured_at_utc=captured_at,
        )
        planner.begin()
        planner.stage(updated, LogCoordinate(checkpoint.file, 545))
        planner.stage(deleted, LogCoordinate(checkpoint.file, 575))
        plan = planner.prepare_commit(LogCoordinate(checkpoint.file, 620))
        self.assertEqual(plan.changes[0].source_timestamp_state, "NOT_ADVANCED_ON_UPDATE")
        self.assertTrue(plan.changes[1].needs_tombstone)
        self.assertEqual(planner.checkpoint, checkpoint)
        for secret in ("PRIVATE_PAYROLL_TOKEN", "PRIVATE_SALARY", "OTHER_PRIVATE_SALARY"):
            self.assertNotIn(secret, repr(plan))
        self.assertEqual(plan.changes[0].captured_at_utc.microsecond, 987654)
        self.assertEqual(plan.changes[0].binlog_event_at_utc.microsecond, 0)

        planner.confirm_durable_commit(plan)
        self.assertEqual(planner.checkpoint, LogCoordinate(checkpoint.file, 620))

    def test_rejects_insufficient_retention_without_touching_checkpoint(self):
        checkpoint = LogCoordinate("mysql-bin-changelog.000055", 500)
        proof = SnapshotHandoff(
            schema="ingest_stage", binlog_file=checkpoint.file,
            binlog_position=checkpoint.position,
            snapshot_consistent=True, snapshot_import_verified=True,
            snapshot_manifest_sha256="b" * 64, retention_hours=0,
        )
        with self.assertRaises(ValueError):
            TransactionPlanner(checkpoint, handoff=proof)


if __name__ == "__main__":
    unittest.main()
