"""No AWS needed: verify metadata audit and optional EXPLAIN are bounded/read-only."""
import unittest
from unittest.mock import MagicMock

from ops.aws_mysql_chart_audit import DIMENSIONS, inspect, explain_failure_code
from runtime.ingest_stage_contract import FEED_TABLES


def database(*, missing=False):
    conn = MagicMock()
    cur = conn.cursor.return_value.__enter__.return_value
    cols = []
    for feed, dims in DIMENSIONS.items():
        cols.append(("v_" + feed, "employer_ref"))
        for dim in dims:
            if not (missing and feed == "employees" and dim == "site_name"):
                cols.append(("v_" + feed, dim))
    indexes = [(feed, "PRIMARY", 1, "_ingest_id") for feed in FEED_TABLES]
    cur.fetchall.side_effect = [cols, indexes]
    return conn, cur


class NativeChartAuditTests(unittest.TestCase):
    def test_no_query_runs_against_source_tables(self):
        conn, cur = database()
        result = inspect(conn)
        self.assertEqual(result["status"], "PASS")
        self.assertFalse(result["aws_writes_performed"])
        self.assertFalse(result["latency_measured"])
        self.assertEqual(len(result["feeds"]), 10)
        self.assertEqual(cur.execute.call_count, 2)
        for call in cur.execute.call_args_list:
            self.assertIn("information_schema", call.args[0])
        self.assertTrue(all(not f["base_table_employer_ref_leading_index"] for f in result["feeds"].values()))

    def test_missing_dimension_flags_review_and_never_claims_speed(self):
        conn, _ = database(missing=True)
        output = inspect(conn)
        self.assertEqual(output["status"], "REVIEW_REQUIRED")
        self.assertIn("site_name", output["feeds"]["employees"]["missing_chart_dimensions"])
        self.assertFalse(output["latency_measured"])

    def test_optional_explain_only_on_existing_view_dimensions(self):
        conn, cur = database(missing=True)
        columns, indexes = cur.fetchall.side_effect
        plan = [(1, "SIMPLE", "employees", None, "ref", "k", "k", "4", "const", 19, 100, "Using where")]
        cur.fetchall.side_effect = [columns, indexes] + [plan] * (sum(len(dims) for dims in DIMENSIONS.values()) - 1)
        output = inspect(conn, include_explain=True)
        self.assertEqual(output["status"], "REVIEW_REQUIRED")
        self.assertFalse(output["explain_analyze_executed"])
        self.assertEqual(output["feeds"]["journeys"]["explain"]["status"]["estimated_rows_total"], 19)
        for call in cur.execute.call_args_list[2:]:
            self.assertTrue(call.args[0].startswith("EXPLAIN SELECT"))
            self.assertNotIn("EXPLAIN ANALYZE", call.args[0])
            self.assertEqual(call.args[1], ("__CDC_EXPLAIN_NONMATCHING_SCOPE__",))


    def test_unavailable_explain_never_claims_pass(self):
        conn, cur = database()
        columns, indexes = cur.fetchall.side_effect
        cur.fetchall.side_effect = [columns, indexes]
        output = inspect(conn, include_explain=True)
        self.assertEqual(output["status"], "REVIEW_REQUIRED")
        self.assertEqual(
            output["feeds"]["journeys"]["explain"]["status"]["status"],
            "EXPLAIN_NOT_AVAILABLE",
        )

    def test_employer_index_must_be_first_column(self):
        conn, cur = database()
        columns, indexes = cur.fetchall.side_effect
        indexes.append(("employees", "idx_nonleading", 2, "employer_ref"))
        cur.fetchall.side_effect = [columns, indexes]
        output = inspect(conn)
        self.assertFalse(
            output["feeds"]["employees"]["base_table_employer_ref_leading_index"]
        )


    def test_explain_failure_redacts_sensitive_driver_messages(self):
        for errno, expected in [
            (1142, "MYSQL_PERMISSION_DENIED"),
            (1345, "MYSQL_VIEW_EXPLAIN_PRIVILEGE_RESTRICTION"),
            (1356, "MYSQL_VIEW_DEFINER_OR_REFERENCE"),
            (1064, "MYSQL_QUERY_CONTRACT"),
            (2013, "MYSQL_CONNECTION_OR_TIMEOUT"),
            (9999, "MYSQL_SERVER_ERROR"),
        ]:
            report = explain_failure_code(RuntimeError(
                errno, "sensitive SQL source credentials never log"
            ))
            self.assertEqual(report["mysql_errno"], errno)
            self.assertEqual(report["category"], expected)
            self.assertNotIn("sensitive", str(report))
        unknown = explain_failure_code(ValueError("secret query"))
        self.assertEqual(unknown["category"], "CLIENT_OR_RESULT_PARSING_ERROR")
        self.assertIsNone(unknown["mysql_errno"])

if __name__ == "__main__":
    unittest.main()
