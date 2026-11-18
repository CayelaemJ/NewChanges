"""Safety contract for read-only ingest_stage metadata inspection.

This audit must never mutate existing RDS source rows, schema or credentials.
"""
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / "ops" / "ingest_stage_readonly_audit.sql"
EXPECTED_FEEDS = {
    "employers", "workforce_snapshots", "employees", "platform_users",
    "journeys", "debt_accounts", "policies", "ratings", "referrals",
    "salary_advances",
}


def query_statements():
    raw = AUDIT.read_text(encoding="utf-8")
    # The shipped query file must contain no executable statement that writes.
    stripped = re.sub(r"(?m)^\s*--[^\n]*$", "", raw)
    statements = [statement.strip() for statement in stripped.split(";") if statement.strip()]
    return raw, statements


class IngestStageReadOnlyContract(unittest.TestCase):
    def test_audit_uses_metadata_only_without_mutating_source(self):
        raw, statements = query_statements()
        self.assertEqual(len(statements), 6)
        for statement in statements:
            with self.subTest(statement=statement[:50]):
                self.assertRegex(statement, r"^(?:SELECT|WITH)\b")
                self.assertNotRegex(statement, r"(?i)\b(?:INSERT|REPLACE|UPDATE|DELETE|TRUNCATE|ALTER|DROP|GRANT|CREATE|CALL|SET)\s+(?:TABLE|USER|INTO|FROM|ON|DATABASE|time_zone)\b")
                self.assertNotRegex(statement, r"(?i)\b(?:FROM|JOIN)\s+ingest_stage\.")
        self.assertIn("information_schema.TABLES", raw)
        self.assertIn("information_schema.COLUMNS", raw)
        self.assertIn("information_schema.KEY_COLUMN_USAGE", raw)
        self.assertIn("information_schema.VIEWS", raw)

    def test_mysql84_reserved_timestamp_aliases_are_not_used(self):
        # UTC_TIME and UTC_TIMESTAMP are reserved keywords in MySQL 8.4.
        # Do not confuse a valid UTC_TIMESTAMP(6) call with an invalid alias.
        paths = [AUDIT, ROOT / "ops" / "preflight.sql"]
        for path in paths:
            sql = path.read_text(encoding="utf-8")
            with self.subTest(path=str(path)):
                self.assertNotRegex(
                    sql, r"(?im)\bAS\s+(?:utc_time|utc_date|utc_timestamp)\b"
                )
                self.assertIn("AS current_utc_datetime", sql)

    def test_preflight_sql_is_packaged_in_docker_image(self):
        # Host-green metadata tests must not fail inside Docker with
        # FileNotFoundError: Dockerfile.test uses explicit COPY instructions.
        dockerfile = (ROOT / "Dockerfile.test").read_text(encoding="utf-8")
        for filename in (
            "preflight.sql",
            "ingest_stage_readonly_audit.sql",
            "ingest_stage_timestamp_lineage.sql",
            "ingest_stage_lineage_summary_readonly.sql",
            "ingest_stage_cdc_identity_readonly.sql",
        ):
            with self.subTest(filename=filename):
                self.assertTrue((ROOT / "ops" / filename).is_file())
                self.assertIn(
                    f"COPY ops/{filename} ops/{filename}",
                    dockerfile,
                )

    def test_expected_canonical_views_match_ten_feed_names(self):
        raw, _ = query_statements()
        first_cte = raw.split("-- 2. Missing required canonical columns")[0]
        feeds = set(re.findall(r"SELECT '([a-z_]+)' AS feed\b", first_cte))
        self.assertEqual(feeds, EXPECTED_FEEDS)
        self.assertIn("MISSING_SOURCE_UPDATED_AT", raw)
        self.assertIn("MISSING_PRIMARY_KEY", raw)
        self.assertIn("REVIEW_DYNAMIC_CLOCK", raw)

    def test_audit_requires_watermark_for_every_feed(self):
        raw, _ = query_statements()
        expected_columns = re.findall(
            r"(?:SELECT|UNION ALL SELECT) '([a-z_]+)' AS feed, '([a-z_]+)' AS column_name",
            raw,
        )
        self.assertEqual(len(expected_columns), 59)
        mapped = {}
        for feed, col in expected_columns:
            mapped.setdefault(feed, set()).add(col)
        self.assertEqual(set(mapped), EXPECTED_FEEDS)
        self.assertTrue(all("source_updated_at" in mapped[feed] for feed in EXPECTED_FEEDS))
        # These are directly from the existing reportFormats.ts required fields.
        self.assertIn("account_ref", mapped["debt_accounts"])
        self.assertIn("as_of_date", mapped["workforce_snapshots"])
        self.assertIn("advanced_at", mapped["salary_advances"])


if __name__ == "__main__":
    unittest.main()
