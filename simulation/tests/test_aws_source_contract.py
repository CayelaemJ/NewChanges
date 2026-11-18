"""Offline tests of AWS metadata-only source contract (never connect to AWS)."""
import unittest
from unittest.mock import MagicMock

from ops.aws_source_contract import inspect_contract
from runtime.ingest_stage_contract import FEED_TABLES


def fake_db(*, future_extra=False, missing_pk=False):
    db = MagicMock()
    cur = db.cursor.return_value.__enter__.return_value
    tables = [(feed, "BASE TABLE", "InnoDB") for feed in sorted(FEED_TABLES)]
    tables += [("v_" + feed, "VIEW", None) for feed in sorted(FEED_TABLES)]
    tables += [("import_manifest", "BASE TABLE", "InnoDB")]
    if future_extra:
        tables.append(("unreviewed_sensitive", "BASE TABLE", "InnoDB"))
    cols = []
    for feed in sorted(FEED_TABLES):
        cols.extend([
            (feed, "_ingest_id", "bigint", "" if missing_pk else "PRI", "", ""),
            (feed, "source_updated_at", "text", "", "", ""),
            (feed, "_source_updated_utc", "datetime", "", "VIRTUAL GENERATED",
             "str_to_date(source_updated_at, '%Y-%m-%d')"),
        ])
    cols.append(("import_manifest", "loaded_at", "timestamp", "", "", ""))
    cur.fetchall.side_effect = [tables, cols]
    return db, cur


class AwsContractTests(unittest.TestCase):
    def test_exact_canonical_contract(self):
        db, cur = fake_db()
        result = inspect_contract(db)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(len(result["feeds"]), 10)
        self.assertEqual(result["live_cdc"], "NOT_ACTIVATED")
        self.assertEqual(cur.execute.call_count, 2)
        queries = [c.args[0].upper() for c in cur.execute.call_args_list]
        self.assertTrue(all("INFORMATION_SCHEMA" in q for q in queries))
        self.assertFalse(any("UPDATE " in q or "DELETE " in q or "INSERT " in q
                             for q in queries))

    def test_unexpected_schema_object_blocks_pass(self):
        db, _ = fake_db(future_extra=True)
        result = inspect_contract(db)
        self.assertEqual(result["status"], "REVIEW_REQUIRED")
        self.assertEqual(result["unexpected_objects"], ["unreviewed_sensitive"])

    def test_missing_primary_key_blocks_pass(self):
        db, _ = fake_db(missing_pk=True)
        result = inspect_contract(db)
        self.assertEqual(result["status"], "REVIEW_REQUIRED")
        self.assertFalse(result["feeds"]["employees"]["primary_ingest_id_bigint"])


if __name__ == "__main__":
    unittest.main()
