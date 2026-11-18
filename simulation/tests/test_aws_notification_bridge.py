"""Offline XID boundary integration: no AWS, no row payload handling."""
from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest

from runtime.aws_notification_bridge import NotificationTransactionBridge
from runtime.aws_notification_contract import (
    NotificationBaseline, source_contract_fingerprint,
)
from runtime.aws_notification_sqlite import SqliteNotificationStore

FILE = "mysql-bin-changelog.000055"


class NotificationBridgeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = SqliteNotificationStore(Path(self.temp.name) / "cdc.sqlite")
        self.baseline = NotificationBaseline(
            source_id="fixer-synthetic-mysql", binlog_file=FILE,
            binlog_position=500,
            captured_at_utc=datetime(2026,11,17,tzinfo=timezone.utc),
            source_fingerprint=source_contract_fingerprint(),
            approval="YES_NOTIFICATION_BASELINE_NO_HISTORICAL_COPY",
            retention_hours=24
        )
        self.store.bootstrap(self.baseline)
        self.bridge = NotificationTransactionBridge(
            baseline=self.baseline, store=self.store
        )

    def row(self, table="employees", op="WRITE_ROWS", pos=545, count=1):
        return self.bridge.row(
            operation=op, schema="ingest_stage", table=table,
            file=FILE, position=pos, row_count=count
        )

    def test_no_notification_or_checkpoint_before_xid(self):
        self.row()
        self.assertEqual(self.store.generations(self.baseline.source_id)["employees"], 0)
        self.assertEqual(self.store.checkpoint(self.baseline.source_id).position,500)
        self.assertEqual(self.bridge.xid(file=FILE,position=600),"PERSISTED")
        self.assertEqual(self.store.checkpoint(self.baseline.source_id).position,600)
        self.assertEqual(self.store.generations(self.baseline.source_id)["employees"],1)

    def test_multiple_operations_only_increment_each_feed_once(self):
        self.row("employees","WRITE_ROWS",545)
        self.row("employees","UPDATE_ROWS",550)
        self.row("policies","DELETE_ROWS",570)
        self.bridge.xid(file=FILE,position=600)
        g = self.store.generations(self.baseline.source_id)
        self.assertEqual(g["employees"],1)
        self.assertEqual(g["policies"],1)
        self.assertEqual(g["employers"],0)

    def test_ignored_xid_cannot_change_checkpoint(self):
        self.assertEqual(self.bridge.xid(file=FILE,position=600),
                         "IGNORED_NO_ALLOWLISTED_ROWS")
        self.assertEqual(self.store.checkpoint(self.baseline.source_id).position,500)

    def test_abort_discards_uncommitted_change(self):
        self.row()
        self.bridge.abort()
        self.assertEqual(self.bridge.xid(file=FILE,position=600),
                         "IGNORED_NO_ALLOWLISTED_ROWS")
        self.assertEqual(self.store.generations(self.baseline.source_id)["employees"],0)

    def test_non_allowlisted_row_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "outside approved"):
            self.row("import_manifest")
        self.assertFalse(self.bridge.pending)
        self.assertEqual(self.store.checkpoint(self.baseline.source_id).position,500)

    def test_invalid_xid_cannot_persist(self):
        self.row()
        with self.assertRaisesRegex(ValueError,"XID"):
            self.bridge.xid(file=FILE,position=545)
        self.assertEqual(self.store.checkpoint(self.baseline.source_id).position,500)
        self.assertFalse(self.bridge.pending)

    def test_source_transaction_limit_cannot_persist(self):
        self.bridge = NotificationTransactionBridge(
            baseline=self.baseline, store=self.store,max_rows=2
        )
        self.row(count=2)
        with self.assertRaisesRegex(ValueError,"row limit"):
            self.row(pos=550,count=1)
        self.assertFalse(self.bridge.pending)
        self.assertEqual(self.store.checkpoint(self.baseline.source_id).position,500)

    def test_restart_uses_durable_checkpoint_and_rejects_old_event(self):
        self.row()
        self.bridge.xid(file=FILE,position=600)
        reopened = SqliteNotificationStore(self.store.path)
        bridge = NotificationTransactionBridge(
            baseline=self.baseline, store=reopened
        )
        with self.assertRaisesRegex(ValueError,"not after durable"):
            bridge.row(operation="WRITE_ROWS",schema="ingest_stage",
                       table="employees",file=FILE,position=545,row_count=1)
        self.assertEqual(reopened.generations(self.baseline.source_id)["employees"],1)

    def test_source_packet_does_not_accept_raw_row_payload(self):
        with self.assertRaises(TypeError):
            self.bridge.row(operation="WRITE_ROWS",schema="ingest_stage",
                table="employees",file=FILE,position=545,row_count=1,
                values={"salary":"do not persist"})
        self.assertEqual(self.store.checkpoint(self.baseline.source_id).position,500)


if __name__ == "__main__":
    unittest.main()
