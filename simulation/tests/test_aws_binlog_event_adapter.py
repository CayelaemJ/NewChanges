"""Offline tests for parsed MySQL event metadata -> committed CDC notifications."""
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

from runtime.aws_binlog_event_adapter import (
    accept_parsed_event, consume_bounded_events,
)
from runtime.aws_notification_bridge import NotificationTransactionBridge
from runtime.aws_notification_contract import (
    NotificationBaseline, source_contract_fingerprint,
)
from runtime.aws_notification_sqlite import SqliteNotificationStore

FILE = "mysql-bin-changelog.000055"


def make_event(kind, pos, *, schema="ingest_stage", table="employees", n=1):
    cls = type(kind, (), {})
    event = cls()
    event.packet = SimpleNamespace(log_pos=pos)
    event.schema = schema
    event.table = table
    event.rows = [{"values": {"salary": "SECRET_VALUE"}} for _ in range(n)]
    return event


class AwsBinlogAdapterTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.store = SqliteNotificationStore(Path(directory.name) / "state.db")
        self.baseline = NotificationBaseline(
            source_id="fixer-synthetic-mysql",binlog_file=FILE,
            binlog_position=500,
            captured_at_utc=datetime(2026,11,17,tzinfo=timezone.utc),
            source_fingerprint=source_contract_fingerprint(),
            approval="YES_NOTIFICATION_BASELINE_NO_HISTORICAL_COPY",
            retention_hours=24,
        )
        self.store.bootstrap(self.baseline)
        self.bridge = NotificationTransactionBridge(
            baseline=self.baseline, store=self.store
        )

    def gen(self):
        return self.store.generations(self.baseline.source_id)["employees"]

    def test_row_stages_only_until_xid(self):
        event = make_event("WriteRowsEvent",545)
        self.assertEqual(accept_parsed_event(self.bridge,event,binlog_file=FILE),1)
        self.assertEqual(self.gen(),0)
        self.assertEqual(self.store.checkpoint(self.baseline.source_id).position,500)
        xid = make_event("XidEvent",600)
        self.assertEqual(accept_parsed_event(self.bridge,xid,binlog_file=FILE),
                         "PERSISTED")
        self.assertEqual(self.gen(),1)
        self.assertEqual(self.store.checkpoint(self.baseline.source_id).position,600)

    def test_combined_insert_update_delete_one_notification(self):
        events = [
            (make_event("WriteRowsEvent",545),FILE),
            (make_event("UpdateRowsEvent",550),FILE),
            (make_event("DeleteRowsEvent",570),FILE),
            (make_event("XidEvent",600),FILE),
        ]
        self.assertEqual(consume_bounded_events(self.bridge,events),
                         {"events":4,"commits":1})
        self.assertEqual(self.gen(),1)

    def test_unknown_event_aborts_without_advancing(self):
        events = [
            (make_event("WriteRowsEvent",545),FILE),
            (make_event("QueryEvent",550),FILE),
        ]
        with self.assertRaisesRegex(ValueError,"Unexpected"):
            consume_bounded_events(self.bridge,events)
        self.assertEqual(self.gen(),0)
        self.assertEqual(self.store.checkpoint(self.baseline.source_id).position,500)

    def test_incomplete_xid_never_publishes(self):
        with self.assertRaisesRegex(ValueError,"Incomplete transaction"):
            consume_bounded_events(
                self.bridge, [(make_event("WriteRowsEvent",545),FILE)]
            )
        self.assertEqual(self.gen(),0)
        self.assertFalse(self.bridge.pending)

    def test_unknown_physical_table_rejected(self):
        with self.assertRaisesRegex(ValueError,"outside approved"):
            accept_parsed_event(
                self.bridge,
                make_event("WriteRowsEvent",545,table="import_manifest"),
                binlog_file=FILE)
        self.assertEqual(self.gen(),0)

    def test_bounded_event_limit_preserves_checkpoint(self):
        with self.assertRaisesRegex(ValueError,"Event limit"):
            consume_bounded_events(
                self.bridge,
                [(make_event("WriteRowsEvent",545),FILE),
                 (make_event("XidEvent",600),FILE)],
                max_events=1
            )
        self.assertEqual(self.gen(),0)

    def test_raw_rows_never_stored(self):
        consume_bounded_events(self.bridge, [
            (make_event("WriteRowsEvent",545),FILE),
            (make_event("XidEvent",600),FILE)
        ])
        with open(self.store.path,"rb") as f:
            self.assertNotIn(b"SECRET_VALUE",f.read())

    def test_no_allowlisted_rows_xid_is_not_false_commit(self):
        result = consume_bounded_events(
            self.bridge,[(make_event("XidEvent",600),FILE)]
        )
        self.assertEqual(result,{"events":1,"commits":0})
        self.assertEqual(self.store.checkpoint(self.baseline.source_id).position,500)


if __name__ == "__main__":
    unittest.main()
