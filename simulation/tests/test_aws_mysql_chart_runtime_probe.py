"""Offline contract for the explicitly approved read-only chart smoke probe."""
import unittest
from unittest.mock import MagicMock, patch

from ops.aws_mysql_chart_runtime_probe import SQL, DISCOVER_SQL, probe, main


class ChartRuntimeProbeTests(unittest.TestCase):
    def make_connection(self, rows):
        conn = MagicMock()
        cur = conn.cursor.return_value.__enter__.return_value
        cur.fetchall.return_value = rows
        return conn, cur

    def test_real_aggregation_is_parameterized_and_returns_no_bucket_values(self):
        conn, cur = self.make_connection([("COMPLETED_PRIVATE", 9), ("STARTED_PRIVATE", 3)])
        output = probe(conn, "AUTHORISATION_GRANTED")
        self.assertEqual(output["status"], "PASS")
        self.assertEqual(output["groups"], 2)
        self.assertTrue(output["source_rows_exported"] is False)
        self.assertNotIn("PRIVATE", str(output))
        self.assertEqual(cur.execute.call_args_list[-1].args,
                         (SQL, ("AUTHORISATION_GRANTED",)))
        self.assertTrue(SQL.startswith("SELECT"))
        self.assertIn("MAX_EXECUTION_TIME", SQL)
        self.assertNotIn("AUTHORISATION_GRANTED", SQL)

    def test_empty_scope_is_inconclusive(self):
        conn, _ = self.make_connection([])
        self.assertEqual(probe(conn, "EMPLOYER")["status"], "EMPTY_SCOPE_INCONCLUSIVE")

    def test_invalid_results_rejected(self):
        for rows in [[("X", -1)], [("X", 1.2)], [("X", True)],
                     [("X", 1, "SECRET")], [("X", 1)] * 21]:
            conn, _ = self.make_connection(rows)
            with self.assertRaisesRegex(ValueError, "CHART_"):
                probe(conn, "EMPLOYER")

    def test_bad_employer_never_creates_mysql_connection(self):
        conn, cur = self.make_connection([])
        for value in ("", " ", " x ", "x" * 201):
            with self.assertRaisesRegex(ValueError, "AUTHORIZED_EMPLOYER"):
                probe(conn, value)
        cur.execute.assert_not_called()


    def test_auto_sample_uses_hidden_fixture_employer_and_parameterized_aggregate(self):
        conn, cur = self.make_connection([])
        cur.fetchall.side_effect = [
            [("PRIVATE_SOURCE_EMPLOYER",)],
            [("COMPLETED", 12)],
        ]
        output = probe(conn)
        self.assertEqual(output["status"], "PASS")
        self.assertEqual(output["groups"], 1)
        self.assertEqual(output["employer_selection"], "AUTO_SYNTHETIC_FIXTURE")
        self.assertNotIn("PRIVATE_SOURCE_EMPLOYER", str(output))
        self.assertEqual(cur.execute.call_args_list[-2].args, (DISCOVER_SQL,))
        self.assertEqual(cur.execute.call_args_list[-1].args,
                         (SQL, ("PRIVATE_SOURCE_EMPLOYER",)))

    def test_auto_sample_with_no_journeys_is_inconclusive(self):
        conn, cur = self.make_connection([])
        output = probe(conn)
        self.assertEqual(output["status"], "NO_JOURNEY_EMPLOYER_INCONCLUSIVE")
        self.assertEqual(cur.execute.call_args_list[-1].args, (DISCOVER_SQL,))

    def test_auto_sample_rejects_invalid_hidden_employer(self):
        conn, cur = self.make_connection([("",)])
        with self.assertRaisesRegex(ValueError, "CHART_DISCOVERY_RESULT_INVALID"):
            probe(conn)
        self.assertEqual(cur.execute.call_args_list[-1].args, (DISCOVER_SQL,))


    def test_three_repetitions_reuse_one_discovered_employer_and_do_not_log_values(self):
        conn, cur = self.make_connection([])
        cur.fetchall.side_effect = [
            [("SECRET_EMPLOYER",)],
            [("SECRET_BUCKET", 12)],
            [("SECRET_BUCKET", 12)],
            [("SECRET_BUCKET", 12)],
        ]
        output = probe(conn, repeats=3)
        self.assertEqual(output["status"], "PASS")
        self.assertEqual(output["groups"], 1)
        self.assertEqual(len(output["aggregation_samples_ms"]), 3)
        self.assertGreaterEqual(output["aggregation_mean_ms"], 0)
        self.assertIn("discovery_ms", output)
        self.assertIn("transaction_setup_ms", output)
        self.assertNotIn("SECRET", str(output))
        self.assertEqual(
            [call.args for call in cur.execute.call_args_list if call.args[0] == SQL],
            [(SQL, ("SECRET_EMPLOYER",))] * 3,
        )
        self.assertEqual(
            sum(call.args[0] == DISCOVER_SQL for call in cur.execute.call_args_list), 1
        )

    def test_three_repetitions_fail_closed_on_inconsistent_aggregates(self):
        conn, cur = self.make_connection([])
        cur.fetchall.side_effect = [[("X", 1)], [("X", 1)], [("X", 2)]]
        with self.assertRaisesRegex(ValueError, "CHART_REPEAT_RESULT_CHANGED"):
            probe(conn, "EMPLOYER", repeats=3)

    def test_repetitions_are_bounded_before_sql_execution(self):
        for n in (0, 4, -1, True, 1.1):
            conn, cur = self.make_connection([])
            with self.assertRaisesRegex(ValueError, "CHART_REPETITION_BUDGET_INVALID"):
                probe(conn, "EMPLOYER", repeats=n)
            cur.execute.assert_not_called()

    def test_default_off_main_refuses_before_connect(self):
        with patch.dict("os.environ", {}, clear=True):
            self.assertEqual(main(), 1)


if __name__ == "__main__":
    unittest.main()
