"""Offline tests for atomic dev-only notification store (no AWS connection)."""
from datetime import datetime, timezone
from hashlib import sha256
import tempfile
from pathlib import Path
import unittest

from runtime.aws_notification_contract import (
    NotificationBaseline, source_contract_fingerprint,
)
from runtime.aws_notification_sqlite import SqliteNotificationStore
from runtime.ingest_stage_txn import LogCoordinate

FILE = "mysql-bin-changelog.000055"


def baseline(**overrides):
    values = dict(
        source_id="fixer-synthetic-mysql", binlog_file=FILE,
        binlog_position=545,
        captured_at_utc=datetime(2026,11,17,tzinfo=timezone.utc),
        source_fingerprint=source_contract_fingerprint(),
        approval="YES_NOTIFICATION_BASELINE_NO_HISTORICAL_COPY",
        retention_hours=24,
    )
    values.update(overrides)
    return NotificationBaseline(**values)


def digest(value):
    return sha256(value.encode()).hexdigest()


class SqliteNotificationStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = SqliteNotificationStore(Path(self.tmp.name) / "state.sqlite")
        self.b = baseline()
        self.assertEqual(self.store.bootstrap(self.b), "BOOTSTRAPPED")

    def tearDown(self):
        self.tmp.cleanup()

    def test_bootstrap_is_idempotent_but_rejects_new_origin(self):
        self.assertEqual(self.store.bootstrap(self.b), "ALREADY_BOOTSTRAPPED")
        with self.assertRaisesRegex(ValueError, "mismatch"):
            self.store.bootstrap(baseline(binlog_position=600))
        self.assertEqual(self.store.checkpoint(self.b.source_id).position, 545)

    def test_commit_advances_checkpoint_and_only_affected_feeds(self):
        prev = self.store.checkpoint(self.b.source_id)
        self.assertEqual(self.store.commit(
            self.b, prev, LogCoordinate(FILE,600),
            ("employees","policies","employees"),digest("x")
        ), "PERSISTED")
        next_cp = self.store.checkpoint(self.b.source_id)
        self.assertEqual((next_cp.position,next_cp.generation),(600,1))
        gens = self.store.generations(self.b.source_id)
        self.assertEqual(gens["employees"], 1)
        self.assertEqual(gens["policies"], 1)
        self.assertEqual(gens["employers"], 0)

    def test_replay_is_idempotent_and_conflicting_replay_rejected(self):
        prev = self.store.checkpoint(self.b.source_id)
        coord = LogCoordinate(FILE,600)
        self.store.commit(self.b,prev,coord,["employees"],digest("x"))
        self.assertEqual(self.store.commit(
            self.b,prev,coord,["employees"],digest("x")
        ),"REPLAYED")
        self.assertEqual(self.store.generations(self.b.source_id)["employees"],1)
        with self.assertRaisesRegex(ValueError,"Conflicting replay"):
            self.store.commit(self.b,prev,coord,["employees"],digest("y"))

    def test_stale_checkpoint_does_not_double_increment(self):
        prev = self.store.checkpoint(self.b.source_id)
        self.store.commit(self.b,prev,LogCoordinate(FILE,600),
                          ["employees"],digest("x"))
        with self.assertRaisesRegex(ValueError,"Stale checkpoint"):
            self.store.commit(self.b,prev,LogCoordinate(FILE,650),
                              ["employees"],digest("y"))
        self.assertEqual(self.store.generations(self.b.source_id)["employees"],1)
        self.assertEqual(self.store.checkpoint(self.b.source_id).position,600)

    def test_unapproved_tables_and_backwards_commit_rejected(self):
        prev = self.store.checkpoint(self.b.source_id)
        with self.assertRaises(ValueError):
            self.store.commit(self.b,prev,LogCoordinate(FILE,600),
                              ["import_manifest"],digest("x"))
        with self.assertRaises(ValueError):
            self.store.commit(self.b,prev,LogCoordinate(FILE,544),
                              ["employees"],digest("x"))
        self.assertEqual(self.store.checkpoint(self.b.source_id).position,545)

    def test_store_survives_reopen(self):
        prev = self.store.checkpoint(self.b.source_id)
        self.store.commit(self.b,prev,LogCoordinate(FILE,600),
                          ["debt_accounts"],digest("x"))
        opened = SqliteNotificationStore(self.store.path)
        self.assertEqual(opened.checkpoint(self.b.source_id).position,600)
        self.assertEqual(opened.generations(self.b.source_id)["debt_accounts"],1)


if __name__ == "__main__":
    unittest.main()
