"""Offline tests: never query RDS or persist reporting rows to Postgres."""
import unittest

from runtime.ingest_stage_contract import FEED_TABLES
from runtime.ingest_stage_feed_refresh import (
    BLOCKED_SOURCE, DEFER_RATE_LIMIT, REQUERY_MYSQL, UNCHANGED,
    acknowledged_generation, plan_feed_refresh,
)


def plan(feed="employees", **overrides):
    args = {
        "feed": feed,
        "cached_generation": 1,
        "notified_generation": 2,
        "mysql_source_authorized": True,
        "source_snapshot_verified": True,
        "now_ms": 10_000,
        "last_query_ms": None,
    }
    args.update(overrides)
    return plan_feed_refresh(**args)


class FeedRefreshPlannerTests(unittest.TestCase):
    def test_all_ten_feeds_invalidate_without_row_identity_or_watermark(self):
        for feed in FEED_TABLES:
            with self.subTest(feed=feed):
                result = plan(feed)
                self.assertEqual(result.action, REQUERY_MYSQL)
                self.assertEqual(result.feed, feed)
                self.assertTrue(result.unfiltered_mysql_view_required)
                self.assertEqual(result.generation, 2)
                self.assertFalse(hasattr(result, "raw_row_id"))
                self.assertFalse(hasattr(result, "source_updated_at"))

    def test_no_change_does_not_query_source(self):
        result = plan(notified_generation=1)
        self.assertEqual(result.action, UNCHANGED)
        self.assertFalse(result.unfiltered_mysql_view_required)

    def test_unverified_snapshot_or_source_authorization_fail_closed(self):
        for overrides in (
            {"mysql_source_authorized": False},
            {"source_snapshot_verified": False},
        ):
            with self.subTest(overrides=overrides):
                result = plan(**overrides)
                self.assertEqual(result.action, BLOCKED_SOURCE)
                self.assertFalse(result.unfiltered_mysql_view_required)

    def test_rate_limit_coalesces_feed_invalidation_without_ack(self):
        p = plan(cached_generation=1, notified_generation=15,
                 now_ms=10_000, last_query_ms=9_500,
                 min_query_spacing_ms=1000)
        self.assertEqual(p.action, DEFER_RATE_LIMIT)
        self.assertEqual(p.generation, 15)
        self.assertFalse(p.unfiltered_mysql_view_required)
        self.assertEqual(
            acknowledged_generation(previous_generation=1,
                                    observed_generation=15,
                                    source_read_succeeded=False),
            1,
        )

    def test_applied_generation_advances_only_on_success(self):
        self.assertEqual(
            acknowledged_generation(previous_generation=3,
                                    observed_generation=9,
                                    source_read_succeeded=True),
            9,
        )
        self.assertEqual(
            acknowledged_generation(previous_generation=3,
                                    observed_generation=9,
                                    source_read_succeeded=False),
            3,
        )

    def test_source_checkpoint_regression_refused(self):
        with self.assertRaises(ValueError):
            plan(cached_generation=7, notified_generation=6)
        with self.assertRaises(ValueError):
            acknowledged_generation(previous_generation=7,
                                    observed_generation=6,
                                    source_read_succeeded=True)

    def test_unknown_feed_or_malformed_values_rejected(self):
        with self.assertRaises(ValueError):
            plan("mysql.user")
        for field, invalid in (
            ("cached_generation", True),
            ("notified_generation", -1),
            ("now_ms", -1),
            ("last_query_ms", 10_001),
            ("min_query_spacing_ms", -1),
            ("mysql_source_authorized", "yes"),
            ("source_snapshot_verified", None),
        ):
            with self.subTest(field=field), self.assertRaises(ValueError):
                plan(**{field: invalid})

    def test_nonboolean_success_status_is_rejected(self):
        with self.assertRaises(ValueError):
            acknowledged_generation(previous_generation=1,
                                    observed_generation=2,
                                    source_read_succeeded="true")


if __name__ == "__main__":
    unittest.main()
