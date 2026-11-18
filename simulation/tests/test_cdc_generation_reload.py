"""Unit tests for dashboard generation race prevention (no network)."""
import unittest

from runtime.cdc_generation_reload import (
    GenerationChangedDuringRead, consistent_view_reload,
)


class GenerationReloadTests(unittest.TestCase):
    def test_stable_read(self):
        calls = iter([7, 7])
        result = consistent_view_reload(lambda: next(calls), lambda: [1, 2])
        self.assertEqual(result, {"data": [1, 2], "generation": 7})

    def test_change_during_read_forces_requery(self):
        calls = iter([7, 8, 8, 8])
        visits = []
        def read_view():
            visits.append(len(visits))
            return list(visits)
        result = consistent_view_reload(lambda: next(calls), read_view)
        self.assertEqual(len(visits), 2)
        self.assertEqual(result["generation"], 8)
        self.assertEqual(result["data"], [0, 1])

    def test_continuous_changes_fail_closed(self):
        calls = iter([1, 2, 2, 3])
        with self.assertRaises(GenerationChangedDuringRead):
            consistent_view_reload(lambda: next(calls), lambda: "stale",
                                   attempts=2)

    def test_regression_is_not_accepted(self):
        calls = iter([3, 2])
        with self.assertRaisesRegex(ValueError, "regressed"):
            consistent_view_reload(lambda: next(calls), lambda: 1)

    def test_bounded_attempts_and_valid_counters(self):
        for attempts in (0, 6, True):
            with self.subTest(attempts=attempts), self.assertRaises(ValueError):
                consistent_view_reload(lambda: 1, lambda: 1, attempts=attempts)
        with self.assertRaises(ValueError):
            consistent_view_reload(lambda: -1, lambda: None)


if __name__ == "__main__":
    unittest.main()
