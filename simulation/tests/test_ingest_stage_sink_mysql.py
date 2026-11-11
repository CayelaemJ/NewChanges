"""Real, DISPOSABLE MySQL integration for ingest_stage metadata sink.

Uses only fixer_ingest_cdc initialized in simulation/docker-compose.yml.
Does not read or alter ingest_stage or send any credentials to a real RDS.
"""
import os
import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from runtime.common import connect
from runtime.ingest_stage_contract import SnapshotHandoff, make_change_marker
from runtime.ingest_stage_txn import LogCoordinate, TransactionPlanner
from runtime.ingest_stage_sink import bootstrap_local_sink, persist_local_plan

FILE = "mysql-bin-changelog.000055"
SECRET = b"test-only-hmac-value-with-more-than-32-bytes"


def proof(position=500):
    return SnapshotHandoff(
        schema="ingest_stage", binlog_file=FILE, binlog_position=position,
        snapshot_consistent=True, snapshot_import_verified=True,
        snapshot_manifest_sha256="f" * 64, retention_hours=24,
    )


def plan(start=500, end=600, operation="UPDATE", marker_pos=545):
    cp = LogCoordinate(FILE, start)
    instance = TransactionPlanner(cp, handoff=proof(start))
    instance.begin()
    if operation is not None:
        before = {
            "_ingest_id": 11, "salary": "PRIVATE_SALARY",
            "source_updated_at": "2025-01-01T01:00:00Z",
        }
        after = before | {"salary": "DO_NOT_PERSIST"}
        marker = make_change_marker(
            schema="ingest_stage", table="employees", operation=operation,
            old=before if operation != "INSERT" else None,
            new=None if operation == "DELETE" else after,
            binlog_file=FILE, binlog_position=marker_pos, row_index=0,
            binlog_timestamp=1794391200,
            hmac_secret=SECRET,
            captured_at_utc=datetime(2026, 11, 11, 12, 0, 0, 345678,
                                     tzinfo=timezone.utc),
        )
        instance.stage(marker, LogCoordinate(FILE, marker_pos))
    return instance, instance.prepare_commit(LogCoordinate(FILE, end))


def query(db, sql, values=()):
    with db.cursor() as cur:
        cur.execute(sql, values)
        return cur.fetchall()


@unittest.skipUnless(
    os.getenv("SIM_ENV") == "local"
    and os.getenv("RUN_LOCAL_MYSQL_TESTS") == "yes"
    and os.getenv("SIM_CDC_HOST") == "mysql",
    "Disposable local Docker MySQL required",
)
class LocalIngestSink(unittest.TestCase):
    def setUp(self):
        self.db = connect("cdc")

    def tearDown(self):
        self.db.rollback()
        self.db.close()

    def test_atomic_checkpoint_marker_and_replay(self):
        consumer = "test-ingest-atomic"
        self.assertEqual(bootstrap_local_sink(self.db, proof(), consumer_name=consumer),
                         "BOOTSTRAPPED")
        planner, pending = plan()
        self.assertEqual(
            persist_local_plan(self.db, pending, consumer_name=consumer), "PERSISTED"
        )
        self.assertEqual(planner.checkpoint.position, 500)
        checkpoint = query(
            self.db,
            "SELECT log_pos,last_plan_digest FROM fixer_ingest_cdc.ingest_checkpoint "
            "WHERE consumer_name=%s", (consumer,),
        )[0]
        self.assertEqual(checkpoint, (600, pending.digest))
        self.assertEqual(
            query(self.db, "SELECT COUNT(*) FROM fixer_ingest_cdc.ingest_change_markers "
                 "WHERE event_key=%s", (pending.changes[0].event_key,))[0][0], 1
        )
        notice = query(self.db, "SELECT generation,last_captured_at_utc "
                       "FROM fixer_ingest_cdc.ingest_feed_notifications WHERE feed='employees'")[0]
        self.assertGreaterEqual(notice[0], 1)
        self.assertEqual(notice[1].microsecond, 345678)
        self.assertEqual(
            persist_local_plan(self.db, pending, consumer_name=consumer), "REPLAYED"
        )
        self.assertEqual(
            query(self.db, "SELECT COUNT(*) FROM fixer_ingest_cdc.ingest_change_markers "
                 "WHERE event_key=%s", (pending.changes[0].event_key,))[0][0], 1
        )
        planner.confirm_durable_commit(pending)
        self.assertEqual(planner.checkpoint.position, 600)

    def test_duplicate_source_event_rolls_back_checkpoint(self):
        consumer = "test-ingest-duplicate"
        self.assertEqual(bootstrap_local_sink(self.db, proof(), consumer_name=consumer),
                         "BOOTSTRAPPED")
        _, first = plan(500, 600, marker_pos=560)
        self.assertEqual(persist_local_plan(self.db, first, consumer_name=consumer),
                         "PERSISTED")

        _, second = plan(600, 700, marker_pos=650)
        change = second.changes[0]
        # Simulate a prior conflicting marker insert, independent of other tests.
        # Inserting the collision BEFORE persist tests all-or-nothing rollback.
        with self.db.cursor() as cursor:
            cursor.execute("""INSERT INTO fixer_ingest_cdc.ingest_change_markers
                (event_key,feed,operation,opaque_row_key,source_timestamp_state,
                 needs_tombstone,binlog_event_at_utc,captured_at_utc)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""",
                (change.event_key,change.feed,change.operation,
                 change.opaque_row_key,change.source_timestamp_state,
                 int(change.needs_tombstone),
                 change.binlog_event_at_utc.replace(tzinfo=None),
                 change.captured_at_utc.replace(tzinfo=None)))
        self.db.commit()

        with self.assertRaises(Exception):
            persist_local_plan(self.db, second, consumer_name=consumer)
        self.assertEqual(
            query(self.db, "SELECT log_pos FROM fixer_ingest_cdc.ingest_checkpoint "
                 "WHERE consumer_name=%s", (consumer,))[0][0], 600
        )
        self.assertEqual(
            query(self.db, "SELECT COUNT(*) FROM fixer_ingest_cdc.ingest_change_markers "
                 "WHERE event_key=%s", (change.event_key,))[0][0], 1
        )

    def test_stale_checkpoint_refuses_plan_without_marker_write(self):
        consumer = "test-ingest-stale"
        self.assertEqual(bootstrap_local_sink(self.db, proof(), consumer_name=consumer),
                         "BOOTSTRAPPED")
        _, p = plan(500, 600, marker_pos=546)
        self.assertEqual(persist_local_plan(self.db, p, consumer_name=consumer),
                         "PERSISTED")
        _, stale = plan(500, 700, marker_pos=547)
        with self.assertRaises(ValueError):
            persist_local_plan(self.db, stale, consumer_name=consumer)
        self.assertEqual(query(
            self.db, "SELECT log_pos FROM fixer_ingest_cdc.ingest_checkpoint "
                     "WHERE consumer_name=%s", (consumer,)
        )[0][0], 600)
        self.assertEqual(query(
            self.db, "SELECT COUNT(*) FROM fixer_ingest_cdc.ingest_change_markers "
                     "WHERE event_key=%s", (stale.changes[0].event_key,)
        )[0][0], 0)

    def test_unbootstrapped_consumer_fails_without_source_write(self):
        _, p = plan(500, 600, marker_pos=548)
        with self.assertRaises(ValueError):
            persist_local_plan(self.db, p, consumer_name="test-ingest-unbootstrapped")
        self.assertEqual(query(
            self.db, "SELECT COUNT(*) FROM fixer_ingest_cdc.ingest_change_markers "
                     "WHERE event_key=%s", (p.changes[0].event_key,)
        )[0][0], 0)

    def test_empty_committed_source_transaction_advances_checkpoint(self):
        consumer = "test-ingest-empty"
        self.assertEqual(bootstrap_local_sink(self.db, proof(), consumer_name=consumer),
                         "BOOTSTRAPPED")
        _, empty = plan(operation=None)
        self.assertEqual(empty.changes, ())
        self.assertEqual(persist_local_plan(self.db, empty, consumer_name=consumer),
                         "PERSISTED")
        self.assertEqual(query(
            self.db, "SELECT log_pos FROM fixer_ingest_cdc.ingest_checkpoint "
                     "WHERE consumer_name=%s", (consumer,)
        )[0][0], 600)

    def test_nonlocal_context_denied_before_any_db_write(self):
        _, p = plan(500, 600, marker_pos=549)
        with patch.dict(os.environ, {"SIM_ENV": "production"}):
            with self.assertRaises(RuntimeError):
                persist_local_plan(self.db, p, consumer_name="test-ingest-no-prod")
            with self.assertRaises(RuntimeError):
                bootstrap_local_sink(self.db, proof(), consumer_name="test-ingest-no-prod")

    def test_sink_schema_does_not_expose_raw_payloads(self):
        names = query(
            self.db, "SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS "
                     "WHERE TABLE_SCHEMA='fixer_ingest_cdc'"
        )
        fields = {column.lower() for _, column in names}
        for forbidden in (
            "salary", "email", "bank_account", "payload", "old_payload",
            "new_payload", "raw_row", "employee_name", "account_ref",
        ):
            self.assertNotIn(forbidden, fields)


if __name__ == "__main__":
    unittest.main()
