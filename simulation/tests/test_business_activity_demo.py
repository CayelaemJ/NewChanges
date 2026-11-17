"""Safety contract for the synthetic business activity CDC driver."""
import os
import unittest
from unittest.mock import patch
from ops.business_activity_demo import require_disposable_environment, execute

REQUIRED = {
    "SIM_ENV": "local",
    "RUN_LOCAL_MYSQL_TESTS": "yes",
    "SIMULATION_WRITES_APPROVED": "YES_ISOLATED_SYNTHETIC_ONLY",
    "SIM_CDC_ENABLED": "true",
    "SIM_DB_HOST": "mysql",
    "SIM_CDC_HOST": "mysql",
    "SIM_REPL_HOST": "mysql",
    "SIM_DB_DATABASE": "fixer_sim",
    "SIM_CDC_DATABASE": "fixer_sim_analytics",
    "SIM_REPL_DATABASE": "fixer_sim",
}

class BusinessDemoGuards(unittest.TestCase):
    def test_production_or_nonlocal_host_denied_before_connect(self):
        for name, bad in (("SIM_ENV", "production"), ("SIM_DB_HOST", "live-rds"),
                          ("SIM_CDC_HOST", "live-rds"), ("SIM_REPL_HOST", "live-rds"),
                          ("SIMULATION_WRITES_APPROVED", "")):
            config = dict(REQUIRED, **{name: bad})
            with self.subTest(name=name), patch.dict(os.environ, config, clear=True):
                with self.assertRaisesRegex(RuntimeError, "LOCAL_DISPOSABLE_DEMO_ONLY"):
                    require_disposable_environment()

    def test_missing_approval_denied(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "LOCAL_DISPOSABLE_DEMO_ONLY"):
                execute(1, 0, 1)

    def test_bounded_scenarios_validated_before_connections(self):
        with patch.dict(os.environ, REQUIRED, clear=True):
            for opts in ((0, 0, 1, "safe"), (11, 0, 1, "safe"),
                         (1, 31, 1, "safe"), (1, 0, 0, "safe"),
                         (1, 0, 21, "safe"), (1, 0, 1, "../no")):
                with self.subTest(opts=opts), self.assertRaises(ValueError):
                    execute(*opts)
