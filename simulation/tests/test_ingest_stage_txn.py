"""Offline regression checks: no database, network, credentials or live binlog reader."""
from datetime import datetime, timezone
from hashlib import sha256
from types import SimpleNamespace
import unittest
from runtime.ingest_stage_txn import LogCoordinate, OpaqueChange, TransactionPlanner
from runtime.ingest_stage_contract import SnapshotHandoff


def pos(n=545, file="mysql-bin-changelog.000055"):
    return LogCoordinate(file, n)


def marker(key="first", op="UPDATE", **extra):
    props = dict(
        feed="employees", operation=op,
        event_key=sha256(key.encode()).hexdigest(),
        opaque_row_key=sha256(b"private-row").hexdigest(),
        needs_tombstone=op == "DELETE",
        source_timestamp_state="NOT_ADVANCED_ON_UPDATE" if op == "UPDATE" else
            "DELETED_NO_LIVE_WATERMARK" if op == "DELETE" else "INSERT_TIMESTAMP_UNVERIFIED",
        binlog_event_at_utc=datetime(2026, 11, 6, 10, tzinfo=timezone.utc),
        captured_at_utc=datetime(2026, 11, 6, 10, 0, 1, tzinfo=timezone.utc),
        payroll_ref="PRIVATE_DATA_DO_NOT_LEAK",
    )
    return SimpleNamespace(**(props | extra))


def planner(checkpoint, **kwargs):
    proof = SnapshotHandoff(
        schema="ingest_stage", binlog_file=checkpoint.file,
        binlog_position=checkpoint.position, snapshot_consistent=True,
        snapshot_import_verified=True, snapshot_manifest_sha256="a" * 64,
        retention_hours=24,
    )
    return TransactionPlanner(checkpoint, handoff=proof, **kwargs)


class OfflineTransactionPlannerTests(unittest.TestCase):
    def test_unapproved_initial_coordinate_rejected(self):
        checkpoint = pos(500)
        with self.assertRaises(TypeError):
            TransactionPlanner(checkpoint)
        with self.assertRaises(ValueError):
            TransactionPlanner(checkpoint, handoff=SnapshotHandoff(
                schema="ingest_stage", binlog_file=checkpoint.file,
                binlog_position=checkpoint.position, snapshot_consistent=True,
                snapshot_import_verified=False, snapshot_manifest_sha256="a" * 64,
                retention_hours=24))
        with self.assertRaises(ValueError):
            TransactionPlanner(checkpoint, handoff=SnapshotHandoff(
                schema="ingest_stage", binlog_file=checkpoint.file,
                binlog_position=545, snapshot_consistent=True,
                snapshot_import_verified=True, snapshot_manifest_sha256="a" * 64,
                retention_hours=24))

    def test_checkpoint_never_moves_until_ack(self):
        p = planner(pos(500))
        p.begin()
        p.stage(marker(), pos(545))
        plan = p.prepare_commit(pos(600))
        self.assertEqual(p.checkpoint, pos(500))
        self.assertEqual(plan.next_checkpoint, pos(600))
        self.assertEqual(len(plan.changes), 1)
        self.assertNotIn("PRIVATE_DATA_DO_NOT_LEAK", repr(plan))
        p.confirm_durable_commit(plan)
        self.assertEqual(p.checkpoint, pos(600))

    def test_abort_discards_staged_events_and_keeps_old_checkpoint(self):
        p = planner(pos(500))
        p.begin()
        p.stage(marker(), pos(545))
        p.abort()
        self.assertEqual(p.checkpoint, pos(500))
        p.begin()
        p.stage(marker(), pos(545))

    def test_replay_before_checkpoint_rejected(self):
        p = planner(pos(600))
        p.begin()
        with self.assertRaises(ValueError):
            p.stage(marker(), pos(545))

    def test_duplicate_keys_in_one_source_transaction_blocked(self):
        p = planner(pos(500))
        p.begin()
        p.stage(marker(), pos(545))
        with self.assertRaises(ValueError):
            p.stage(marker(), pos(545))

    def test_multiple_rows_at_same_packet_position_are_accepted(self):
        p = planner(pos(500))
        p.begin()
        p.stage(marker("row1"), pos(545))
        p.stage(marker("row2"), pos(545))
        self.assertEqual(len(p.prepare_commit(pos(600)).changes), 2)

    def test_rejects_partial_batch_after_cap(self):
        p = planner(pos(500), max_rows=1)
        p.begin()
        p.stage(marker(), pos(545))
        with self.assertRaises(RuntimeError):
            p.stage(marker("second"), pos(546))
        self.assertEqual(p.checkpoint, pos(500))
        p.abort()

    def test_cannot_ack_false_plan_or_double_ack(self):
        a = planner(pos(500))
        b = planner(pos(500))
        a.begin()
        b.begin()
        aa = a.prepare_commit(pos(600))
        bb = b.prepare_commit(pos(600))
        with self.assertRaises(RuntimeError):
            a.confirm_durable_commit(bb)
        a.confirm_durable_commit(aa)
        with self.assertRaises(RuntimeError):
            a.confirm_durable_commit(aa)

    def test_wont_prepare_before_commit_or_bad_position(self):
        p = planner(pos(500))
        with self.assertRaises(RuntimeError):
            p.prepare_commit(pos(600))
        p.begin()
        p.stage(marker(), pos(550))
        with self.assertRaises(ValueError):
            p.prepare_commit(pos(540))
        self.assertEqual(p.checkpoint, pos(500))

    def test_rollback_after_prepared_no_advancement(self):
        p = planner(pos(500))
        p.begin()
        p.stage(marker(), pos(545))
        p.prepare_commit(pos(600))
        p.abort()
        self.assertEqual(p.checkpoint, pos(500))
        p.begin()

    def test_binlog_rotation_is_monotonic_same_lineage(self):
        p = planner(pos(500))
        p.begin()
        p.stage(marker(), pos(545))
        p.prepare_commit(pos(4, "mysql-bin-changelog.000056"))
        self.assertEqual(p.checkpoint, pos(500))

    def test_rejects_binlog_lineage_switch(self):
        p = planner(pos(500))
        p.begin()
        with self.assertRaises(ValueError):
            p.stage(marker(), pos(545, "other-binlog.000001"))

    def test_metadata_only_marker_rejects_unlisted_and_malformed(self):
        with self.assertRaises(ValueError):
            OpaqueChange.from_marker(marker(feed="import_manifest"))
        with self.assertRaises(ValueError):
            OpaqueChange.from_marker(marker(event_key="not-a-hash"))
        with self.assertRaises(ValueError):
            OpaqueChange.from_marker(marker(op="DELETE", needs_tombstone=False))

    def test_source_insert_and_hard_delete_supported(self):
        p = planner(pos(500))
        p.begin()
        p.stage(marker("insert", op="INSERT"), pos(545))
        p.stage(marker("delete", op="DELETE"), pos(546))
        plan = p.prepare_commit(pos(600))
        self.assertTrue(plan.changes[1].needs_tombstone)
        self.assertFalse(plan.changes[0].needs_tombstone)

    def test_empty_transaction_has_boundary_and_no_markers(self):
        p = planner(pos(500))
        p.begin()
        plan = p.prepare_commit(pos(600))
        self.assertEqual(plan.changes, ())
        self.assertEqual(p.checkpoint, pos(500))

    def test_last_staged_file_cannot_roll_back(self):
        p = planner(pos(500))
        p.begin()
        p.stage(marker("one"), pos(4, "mysql-bin-changelog.000056"))
        with self.assertRaises(ValueError):
            p.stage(marker("two"), pos(550, "mysql-bin-changelog.000055"))


if __name__ == "__main__":
    unittest.main()
