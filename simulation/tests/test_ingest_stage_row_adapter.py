"""Synthetic MySQL row-event envelopes. Never connect to a source database."""
from datetime import datetime, timezone
from types import SimpleNamespace
import unittest

from runtime.ingest_stage_row_adapter import stage_row_event
from runtime.ingest_stage_contract import SnapshotHandoff
from runtime.ingest_stage_txn import LogCoordinate, TransactionPlanner

FILE = "mysql-bin-changelog.000055"
SECRET = b"a-private-development-only-test-key-of-32-bytes"


def planner():
    cp = LogCoordinate(FILE, 500)
    proof = SnapshotHandoff(
        schema="ingest_stage", binlog_file=FILE, binlog_position=500,
        snapshot_consistent=True, snapshot_import_verified=True,
        snapshot_manifest_sha256="a" * 64, retention_hours=24,
    )
    instance = TransactionPlanner(cp, handoff=proof)
    instance.begin()
    return instance


def event(rows, table="employees", logpos=545):
    return SimpleNamespace(
        schema="ingest_stage", table=table, rows=rows,
        packet=SimpleNamespace(log_pos=logpos), timestamp=1794391200,
    )


class AdapterTests(unittest.TestCase):
    def test_update_remains_stale_and_no_private_data_leaks(self):
        p = planner()
        old = {"_ingest_id": 2, "source_updated_at": "2020-01-01", "salary": "PRIVATE"}
        new = old | {"salary": "SUPER_PRIVATE"}
        count = stage_row_event(
            p, kind="UPDATE_ROWS",
            event=event([{"before_values": old, "after_values": new}]),
            binlog_file=FILE, hmac_secret=SECRET,
            captured_at_utc=datetime(2026, 11, 11, 9, tzinfo=timezone.utc),
        )
        self.assertEqual(count, 1)
        plan = p.prepare_commit(LogCoordinate(FILE, 600))
        self.assertEqual(plan.changes[0].source_timestamp_state, "NOT_ADVANCED_ON_UPDATE")
        self.assertNotIn("PRIVATE", repr(plan))
        self.assertEqual(p.checkpoint.position, 500)

    def test_insert_and_delete_in_same_transaction(self):
        p = planner()
        row = {"_ingest_id": 2, "source_updated_at": "2020-01-01"}
        stage_row_event(
            p, kind="WRITE_ROWS", event=event([{"values": row}]),
            binlog_file=FILE, hmac_secret=SECRET,
        )
        stage_row_event(
            p, kind="DELETE_ROWS", event=event([{"values": row}], logpos=560),
            binlog_file=FILE, hmac_secret=SECRET,
        )
        plan = p.prepare_commit(LogCoordinate(FILE, 600))
        self.assertEqual([change.operation for change in plan.changes], ["INSERT", "DELETE"])
        self.assertTrue(plan.changes[1].needs_tombstone)

    def test_multiple_rows_share_packet_position_not_event_key(self):
        p = planner()
        count = stage_row_event(
            p, kind="WRITE_ROWS",
            event=event([{"values": {"_ingest_id": 2}},
                         {"values": {"_ingest_id": 3}}]),
            binlog_file=FILE, hmac_secret=SECRET,
        )
        self.assertEqual(count, 2)
        plan = p.prepare_commit(LogCoordinate(FILE, 600))
        self.assertNotEqual(plan.changes[0].event_key, plan.changes[1].event_key)

    def test_other_schema_aborts_and_keeps_checkpoint(self):
        p = planner()
        fake = event([{"values": {"_ingest_id": 2}}])
        fake.schema = "other"
        with self.assertRaises(ValueError):
            stage_row_event(p, kind="WRITE_ROWS", event=fake,
                            binlog_file=FILE, hmac_secret=SECRET)
        self.assertEqual(p.checkpoint.position, 500)
        with self.assertRaises(RuntimeError):
            p.prepare_commit(LogCoordinate(FILE, 600))

    def test_invalid_second_row_aborts_all(self):
        p = planner()
        with self.assertRaises(ValueError):
            stage_row_event(
                p, kind="WRITE_ROWS",
                event=event([{"values": {"_ingest_id": 2}},
                             {"values": {"other": 99}}]),
                binlog_file=FILE, hmac_secret=SECRET,
            )
        self.assertEqual(p.checkpoint.position, 500)
        with self.assertRaises(RuntimeError):
            p.prepare_commit(LogCoordinate(FILE, 600))

    def test_unknown_kind_aborts(self):
        p = planner()
        with self.assertRaises(ValueError):
            stage_row_event(p, kind="UNKNOWN", event=event([]),
                            binlog_file=FILE, hmac_secret=SECRET)
        self.assertEqual(p.checkpoint.position, 500)


if __name__ == "__main__":
    unittest.main()
