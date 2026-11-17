"""Offline unit tests: AWS notification baseline never opens a database."""
from datetime import datetime, timezone, timedelta
import unittest

from runtime.aws_notification_contract import (
    NotificationBaseline, NotificationCheckpoint, select_affected_feeds,
    source_contract_fingerprint, validate_resume,
)


FILE = "mysql-bin-changelog.000055"


def baseline(**overrides):
    kwargs = dict(
        source_id="fixer-synthetic-mysql",
        binlog_file=FILE,
        binlog_position=545,
        captured_at_utc=datetime(2026, 11, 17, tzinfo=timezone.utc),
        source_fingerprint=source_contract_fingerprint(),
        approval="YES_NOTIFICATION_BASELINE_NO_HISTORICAL_COPY",
        retention_hours=24,
    )
    kwargs.update(overrides)
    return NotificationBaseline(**kwargs)


def checkpoint(**overrides):
    kwargs = dict(source_id="fixer-synthetic-mysql",
                  file=FILE, position=545, generation=0)
    kwargs.update(overrides)
    return NotificationCheckpoint(**kwargs)


class AwsNotificationContractTests(unittest.TestCase):
    def test_explicit_baseline_and_recoverable_checkpoint(self):
        self.assertEqual(validate_resume(
            baseline(), checkpoint(),
            binlog_files=[FILE, "mysql-bin-changelog.000056"]
        ).position, 545)

    def test_baseline_is_not_historical_snapshot(self):
        b = baseline()
        self.assertFalse(hasattr(b, "snapshot_import_verified"))
        self.assertEqual(b.source_fingerprint, source_contract_fingerprint())

    def test_reject_invalid_approval(self):
        with self.assertRaisesRegex(ValueError, "explicit approval"):
            baseline(approval="YES_METADATA_ONLY")

    def test_reject_wrong_fingerprint_and_timezone(self):
        with self.assertRaisesRegex(ValueError, "fingerprint"):
            baseline(source_fingerprint="a" * 64)
        with self.assertRaisesRegex(ValueError, "timezone"):
            baseline(captured_at_utc=datetime(2026, 11, 17))
        with self.assertRaisesRegex(ValueError, "UTC"):
            baseline(captured_at_utc=datetime(
                2026, 11, 17, tzinfo=timezone(timedelta(hours=2))))

    def test_reject_negative_or_fake_retention(self):
        for value in (0, -1, 169, True):
            with self.subTest(value=value), self.assertRaises(ValueError):
                baseline(retention_hours=value)

    def test_reject_wrong_source_or_backward_resume(self):
        with self.assertRaisesRegex(ValueError, "Source identity"):
            validate_resume(baseline(), checkpoint(source_id="other-source"),
                            binlog_files=[FILE])
        with self.assertRaisesRegex(ValueError, "precedes"):
            validate_resume(baseline(), checkpoint(position=544),
                            binlog_files=[FILE])

    def test_purged_checkpoint_never_silently_skips_to_now(self):
        with self.assertRaisesRegex(ValueError, "missing or purged"):
            validate_resume(baseline(), checkpoint(),
                            binlog_files=["mysql-bin-changelog.000056"])

    def test_no_fake_binlog_inventory(self):
        with self.assertRaisesRegex(ValueError, "inventory"):
            validate_resume(baseline(), checkpoint(), binlog_files=[])
        with self.assertRaises(ValueError):
            validate_resume(baseline(), checkpoint(),
                            binlog_files=["another-lineage.000055"])

    def test_reject_unreviewed_tables(self):
        self.assertEqual(select_affected_feeds(
            ["policies", "employees", "employees"]), ("employees", "policies"))
        with self.assertRaisesRegex(ValueError, "outside approved"):
            select_affected_feeds(["import_manifest"])
        with self.assertRaisesRegex(ValueError, "outside approved"):
            select_affected_feeds(["mysql.user"])


if __name__ == "__main__":
    unittest.main()
