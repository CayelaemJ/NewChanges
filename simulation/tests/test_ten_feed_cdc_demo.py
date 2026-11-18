"""No production connections, no arbitrary SQL, and strict ten-feed parity."""
import os
import unittest
from unittest.mock import patch
from ops.ten_feed_cdc_demo import FEEDS, STATIC_SQL, VIEW_QUERIES, require_isolation, verify_cycle, drive
from runtime.ingest_stage_contract import FEED_TABLES

APPROVED = {
    "SIM_ENV": "local", "RUN_LOCAL_MYSQL_TESTS": "yes",
    "SIMULATION_WRITES_APPROVED": "YES_ISOLATED_SYNTHETIC_ONLY",
    "SIM_DB_HOST": "mysql", "SIM_REPL_HOST": "mysql",
    "SIM_CDC_HOST": "mysql", "SIM_DB_DATABASE": "fixer_sim",
    "SIM_REPL_DATABASE": "fixer_sim",
    "SIM_CDC_DATABASE": "fixer_sim_analytics",
}

class TenFeedDemoContract(unittest.TestCase):
    def test_every_canonical_feed_has_three_static_mutations(self):
        self.assertEqual(set(FEEDS), FEED_TABLES)
        self.assertEqual(set(STATIC_SQL), FEED_TABLES)
        for feed, statements in STATIC_SQL.items():
            self.assertEqual(set(statements), {"insert", "update", "delete"})
            for action, sql in statements.items():
                self.assertIn(feed, sql)
                self.assertIn("%s", sql)
                self.assertTrue(sql.upper().startswith(action.upper()))

    def test_all_ten_views_have_read_only_contract(self):
        self.assertEqual(set(VIEW_QUERIES), FEED_TABLES)
        for feed, sql in VIEW_QUERIES.items():
            self.assertEqual(sql.count("SELECT"), 1)
            self.assertIn("v_" + feed, sql)
            self.assertIn("SYN-DEMO", sql)
        from pathlib import Path
        fixture = Path("schema/004_ingest_stage_fixture.sql").read_text()
        for feed in FEEDS:
            self.assertIn("CREATE VIEW v_" + feed + " AS", fixture)

    def test_refuse_nonlocal_or_missing_approval(self):
        for key, value in (("SIM_ENV", "production"), ("SIM_DB_HOST", "rds.example"),
                           ("SIM_CDC_HOST", "rds.example"), ("SIM_REPL_HOST", "rds.example"),
                           ("SIMULATION_WRITES_APPROVED", "")):
            with self.subTest(key=key), patch.dict(os.environ, dict(APPROVED, **{key:value}), clear=True):
                with self.assertRaisesRegex(RuntimeError, "TEN_FEED_DEMO_DISPOSABLE_ONLY"):
                    require_isolation()

    def test_strict_parity_rejects_missing_feed_marker(self):
        before = {}
        after = {(feed, "INSERT"):1 for feed in FEEDS}
        generations = {feed:1 for feed in FEEDS}
        self.assertEqual(verify_cycle(None, "insert", 1, before, after, generations)["markers_added"], 10)
        after[("employees", "INSERT")] = 0
        with self.assertRaisesRegex(RuntimeError, "TEN_FEED_MARKER_PARITY_FAILED"):
            verify_cycle(None, "insert", 1, before, after, generations)
        after[("employees", "INSERT")] = 1
        generations.pop("employees")
        with self.assertRaisesRegex(RuntimeError, "TEN_FEED_GENERATION_PARITY_FAILED"):
            verify_cycle(None, "insert", 1, before, after, generations)

    def test_no_source_connection_on_invalid_environment(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "TEN_FEED_DEMO_DISPOSABLE_ONLY"):
                drive(delay_seconds=0)
