"""Host-safe tests for explicit MySQL XID commit and local-only CDC guard."""
import os
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from runtime.ingest_stage_contract import SnapshotHandoff
from runtime.ingest_stage_txn import LogCoordinate, TransactionPlanner
from runtime.ingest_stage_stream import LocalIngestBridge, run_local_binlog

FILE = "mysql-bin-changelog.000055"
SECRET = b"unit-test-only-ingest-cdc-hmac-key-32-bytes"


def new_bridge(persist=None):
    handoff = SnapshotHandoff(
        schema="ingest_stage", binlog_file=FILE, binlog_position=500,
        snapshot_consistent=True, snapshot_import_verified=True,
        snapshot_manifest_sha256="a" * 64, retention_hours=24,
    )
    planner = TransactionPlanner(LogCoordinate(FILE, 500), handoff=handoff)
    writes = []
    def writer(plan):
        writes.append(plan)
        return "PERSISTED"
    return LocalIngestBridge(planner, hmac_secret=SECRET,
                             persist=persist or writer), writes


def row_event(op="WRITE_ROWS", pos=545, schema="ingest_stage"):
    old = {"_ingest_id": 11, "source_updated_at": "2025-01-01",
           "salary": "PRIVATE_OLD"}
    new = old | {"salary": "PRIVATE_NEW"}
    image = ({"values": new} if op == "WRITE_ROWS"
             else {"before_values": old, "after_values": new} if op == "UPDATE_ROWS"
             else {"values": old})
    return SimpleNamespace(
        schema=schema, table="employees", rows=[image],
        packet=SimpleNamespace(log_pos=pos), timestamp=1794391200)


def xid(pos=600):
    return SimpleNamespace(packet=SimpleNamespace(log_pos=pos))


class ExplicitXidBoundaryTests(unittest.TestCase):
    def test_marker_and_checkpoint_never_written_before_xid(self):
        bridge, writes = new_bridge()
        bridge.accept("UPDATE_ROWS", row_event("UPDATE_ROWS"),
                      binlog_file=FILE)
        self.assertEqual(writes, [])
        self.assertEqual(bridge.planner.checkpoint.position, 500)
        self.assertEqual(bridge.accept("XID", xid(), binlog_file=FILE),
                         "PERSISTED")
        self.assertEqual(len(writes), 1)
        self.assertEqual(bridge.planner.checkpoint.position, 600)
        self.assertEqual(writes[0].changes[0].source_timestamp_state,
                         "NOT_ADVANCED_ON_UPDATE")
        self.assertNotIn("PRIVATE_NEW", repr(writes[0]))

    def test_foreign_only_xid_ignored_without_persist(self):
        bridge, writes = new_bridge()
        for _ in range(6):
            self.assertEqual(bridge.accept("XID", xid(), binlog_file=FILE),
                             "IGNORED_NO_SOURCE_ROWS")
        self.assertEqual(writes, [])
        self.assertEqual(bridge.planner.checkpoint.position, 500)

    def test_insert_update_delete_within_one_source_transaction(self):
        bridge, writes = new_bridge()
        bridge.accept("WRITE_ROWS", row_event(pos=545), binlog_file=FILE)
        bridge.accept("UPDATE_ROWS", row_event("UPDATE_ROWS", pos=550),
                      binlog_file=FILE)
        bridge.accept("DELETE_ROWS", row_event("DELETE_ROWS", pos=570),
                      binlog_file=FILE)
        self.assertEqual(bridge.accept("XID", xid(), binlog_file=FILE),
                         "PERSISTED")
        self.assertEqual(len(writes), 1)
        self.assertEqual([m.operation for m in writes[0].changes],
                         ["INSERT", "UPDATE", "DELETE"])
        self.assertTrue(writes[0].changes[-1].needs_tombstone)
        self.assertEqual(bridge.marker_count, 3)

    def test_sink_failure_keeps_checkpoint_and_clears_pending(self):
        def fail(_):
            raise RuntimeError("Local durable sink unavailable")
        bridge, _ = new_bridge(fail)
        bridge.accept("WRITE_ROWS", row_event(), binlog_file=FILE)
        with self.assertRaises(RuntimeError):
            bridge.accept("XID", xid(), binlog_file=FILE)
        self.assertEqual(bridge.planner.checkpoint.position, 500)
        self.assertEqual(bridge.commits, 0)
        self.assertFalse(bridge._open)

    def test_abort_on_unexpected_event_before_commit(self):
        bridge, writes = new_bridge()
        bridge.accept("WRITE_ROWS", row_event(), binlog_file=FILE)
        with self.assertRaises(ValueError):
            bridge.accept("QUERY", SimpleNamespace(), binlog_file=FILE)
        self.assertEqual(bridge.planner.checkpoint.position, 500)
        self.assertEqual(writes, [])
        self.assertFalse(bridge._open)

    def test_unknown_schema_refused_without_sink_write(self):
        bridge, writes = new_bridge()
        with self.assertRaises(ValueError):
            bridge.accept("WRITE_ROWS", row_event(schema="fixer_sim"),
                          binlog_file=FILE)
        self.assertEqual(writes, [])
        self.assertEqual(bridge.planner.checkpoint.position, 500)

    def test_replay_requires_newer_source_coordinate(self):
        bridge, _ = new_bridge()
        bridge.accept("WRITE_ROWS", row_event(), binlog_file=FILE)
        bridge.accept("XID", xid(), binlog_file=FILE)
        with self.assertRaises(ValueError):
            bridge.accept("WRITE_ROWS", row_event(), binlog_file=FILE)
        self.assertEqual(bridge.planner.checkpoint.position, 600)

    def test_binlog_rotation_with_real_xid_boundary(self):
        bridge, writes = new_bridge()
        next_file = "mysql-bin-changelog.000056"
        bridge.accept("WRITE_ROWS", row_event(pos=5), binlog_file=next_file)
        self.assertEqual(bridge.accept("XID", xid(800), binlog_file=next_file),
                         "PERSISTED")
        self.assertEqual(writes[0].next_checkpoint.file, next_file)

    def test_rejects_invalid_commit_position_and_no_checkpoint(self):
        bridge, writes = new_bridge()
        bridge.accept("WRITE_ROWS", row_event(pos=545), binlog_file=FILE)
        with self.assertRaises(ValueError):
            bridge.accept("XID", xid(545), binlog_file=FILE)
        self.assertEqual(writes, [])
        self.assertEqual(bridge.planner.checkpoint.position, 500)

    def test_refuses_production_context_before_mysql_import_or_connection(self):
        db = Mock()
        with patch.dict(os.environ, {"SIM_ENV": "production"}):
            with self.assertRaisesRegex(RuntimeError, "disposable local"):
                run_local_binlog(sink_db=db, handoff=None, hmac_secret=SECRET,
                                 consumer_name="pilot")
        db.cursor.assert_not_called()


if __name__ == "__main__":
    unittest.main()
