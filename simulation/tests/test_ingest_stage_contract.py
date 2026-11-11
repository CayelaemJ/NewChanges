"""Pure unit tests: never connect to RDS, read financial rows or write a sink."""
from dataclasses import asdict
from datetime import datetime, timezone
import unittest

from runtime.ingest_stage_contract import (
    FEED_TABLES, SnapshotHandoff, make_change_marker, validate_snapshot_handoff,
)

SECRET = b"a-test-only-constant-with-at-least-32-bytes"
EVENT = dict(schema="ingest_stage", table="employees",
             binlog_file="mysql-bin-changelog.000055",
             binlog_position=545, row_index=0, binlog_timestamp=1793973600,
             hmac_secret=SECRET,
             captured_at_utc=datetime(2026, 11, 6, 14, 20, 2, 123456, tzinfo=timezone.utc))


def event(operation, old, new, **extra):
    return make_change_marker(operation=operation, old=old, new=new, **(EVENT | extra))


class IngestStageContractTests(unittest.TestCase):
    def test_ten_canonical_source_tables_not_manifest(self):
        self.assertEqual(len(FEED_TABLES), 10)
        self.assertNotIn("import_manifest", FEED_TABLES)

    def test_insert_produces_no_raw_row_content(self):
        row = {"_ingest_id": 102, "payroll_ref": "SENSITIVE_TOKEN",
               "salary": "SENSITIVE_PAY", "source_updated_at": "2024-01-01"}
        before = dict(row)
        output = event("INSERT", None, row)
        self.assertEqual(row, before)
        self.assertEqual(output.feed, "employees")
        self.assertEqual(output.source_timestamp_state, "INSERT_TIMESTAMP_UNVERIFIED")
        self.assertEqual(output.captured_at_utc.microsecond, 123456)
        self.assertEqual(output.binlog_event_at_utc.microsecond, 0)
        self.assertNotIn("SENSITIVE_TOKEN", str(asdict(output)))
        self.assertNotIn("SENSITIVE_PAY", str(asdict(output)))
        self.assertNotIn("102", str(asdict(output)))
        self.assertFalse(output.needs_tombstone)

    def test_update_with_unchanged_source_timestamp_is_flagged(self):
        previous = {"_ingest_id": 3, "salary": 5000, "source_updated_at": "2024-01-01"}
        changed = {"_ingest_id": 3, "salary": 6000, "source_updated_at": "2024-01-01"}
        output = event("UPDATE", previous, changed)
        self.assertEqual(output.source_timestamp_state, "NOT_ADVANCED_ON_UPDATE")

    def test_two_updates_same_second_get_distinct_event_keys(self):
        old = {"_ingest_id": 3, "source_updated_at": "2024-01-01"}
        new = {"_ingest_id": 3, "source_updated_at": "2026-11-06"}
        first = event("UPDATE", old, new)
        second = event("UPDATE", old, new, binlog_position=546)
        self.assertNotEqual(first.event_key, second.event_key)
        self.assertEqual(first.opaque_row_key, second.opaque_row_key)
        self.assertEqual(first.source_timestamp_state, "CHANGED_BUT_UNVERIFIED")

    def test_delete_retains_tombstone_marker_but_not_payload(self):
        previous = {"_ingest_id": 3, "email": "private@example.invalid"}
        output = event("DELETE", previous, None)
        self.assertTrue(output.needs_tombstone)
        self.assertEqual(output.source_timestamp_state, "DELETED_NO_LIVE_WATERMARK")
        self.assertNotIn("private@example.invalid", repr(output))

    def test_denies_other_schemas_tables_and_missing_row_id(self):
        with self.assertRaises(ValueError):
            event("INSERT", None, {"_ingest_id": 1}, schema="fixer_sim")
        for name in ("import_manifest", "users", "fixer_sim", "mysql.user"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                event("INSERT", None, {"_ingest_id": 1}, table=name)
        with self.assertRaises(ValueError):
            event("UPDATE", {"_ingest_id": 5}, {"_ingest_id": 6})
        with self.assertRaises(ValueError):
            event("INSERT", None, {"source_updated_at": "2026-11-06"})

    def test_denies_missing_secret_and_invalid_coordinates(self):
        with self.assertRaises(ValueError):
            event("INSERT", None, {"_ingest_id": 1}, hmac_secret=b"short")
        for pos in (0, True, "545", -4):
            with self.subTest(pos=pos), self.assertRaises(ValueError):
                event("INSERT", None, {"_ingest_id": 1}, binlog_position=pos)

    def test_idempotency_is_based_on_coordinates_and_row_index(self):
        row = {"_ingest_id": 1}
        a = event("INSERT", None, row)
        b = event("INSERT", None, row)
        c = event("INSERT", None, row, row_index=1)
        self.assertEqual(a.event_key, b.event_key)
        self.assertNotEqual(a.event_key, c.event_key)

    def test_existing_source_cannot_start_without_verified_snapshot(self):
        correct = SnapshotHandoff(schema="ingest_stage", binlog_file="mysql-bin.000005",
                                  binlog_position=1000, snapshot_consistent=True,
                                  snapshot_import_verified=True,
                                  snapshot_manifest_sha256="a" * 64, retention_hours=24)
        self.assertTrue(validate_snapshot_handoff(correct))
        self.assertRaises(ValueError, validate_snapshot_handoff, None)
        self.assertRaises(ValueError, validate_snapshot_handoff,
                          SnapshotHandoff(**(asdict(correct) | {"snapshot_import_verified": False})))
        self.assertRaises(ValueError, validate_snapshot_handoff,
                          SnapshotHandoff(**(asdict(correct) | {"snapshot_consistent": "yes"})))
        self.assertRaises(ValueError, validate_snapshot_handoff,
                          SnapshotHandoff(**(asdict(correct) | {"retention_hours": 0})))
        self.assertRaises(ValueError, validate_snapshot_handoff,
                          SnapshotHandoff(**(asdict(correct) | {"snapshot_manifest_sha256": ""})))


if __name__ == "__main__":
    unittest.main()
