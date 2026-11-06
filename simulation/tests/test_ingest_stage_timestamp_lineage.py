"""Read-only and coverage contract for live MySQL source timestamp lineage audit."""
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SQL_PATH = ROOT / "ops" / "ingest_stage_timestamp_lineage.sql"
FEEDS = (
    "employers", "workforce_snapshots", "employees", "platform_users",
    "journeys", "debt_accounts", "policies", "ratings", "referrals",
    "salary_advances",
)


class TimestampLineageAuditContract(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        raw = SQL_PATH.read_text(encoding="utf-8")
        # This is a development contract, not a general-purpose SQL parser.
        cleaned = re.sub(r"(?m)^\s*--[^\n]*$", "", raw)
        cls.statements = [s.strip() for s in cleaned.split(";") if s.strip()]
        cls.source = raw

    def test_four_read_only_metadata_selects(self):
        self.assertEqual(len(self.statements), 4)
        for statement in self.statements:
            with self.subTest(statement=statement[:45]):
                self.assertRegex(statement, r"(?is)^SELECT\s")
                self.assertRegex(statement, r"(?i)\bFROM\s+information_schema\.")
                self.assertNotRegex(statement, r"(?i)\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|TRUNCATE|GRANT|CALL|SET)\s")
                self.assertNotRegex(statement, r"(?i)\bFROM\s+ingest_stage\.")
                self.assertNotRegex(statement, r"(?i)\bJOIN\s+ingest_stage\.")

    def test_all_ten_views_and_generated_column_are_inspected(self):
        for feed in FEEDS:
            with self.subTest(feed=feed):
                self.assertIn("'v_" + feed + "'", self.source)
        self.assertIn("GENERATION_EXPRESSION", self.source)
        self.assertIn("VIEW_DEFINITION", self.source)
        self.assertIn("ACTION_STATEMENT", self.source)
        self.assertIn("_source_updated_utc", self.source)
        self.assertIn("_ingest_id", self.source)

    def test_no_credential_or_sensitive_row_queries(self):
        for prohibited in ("mysql.user", "SHOW GRANTS", "SELECT * FROM ingest_stage",
                           "SELECT * FROM `ingest_stage`", "INTO OUTFILE"):
            self.assertNotIn(prohibited, self.source)


if __name__ == "__main__":
    unittest.main()
