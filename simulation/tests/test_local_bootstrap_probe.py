"""Nonsecret diagnostics and isolation contract for local CDC bootstrap probe."""
import io
import os
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

from ops.local_bootstrap_probe import _stage, main


class LocalBootstrapProbeGuards(unittest.TestCase):
    def test_probe_refuses_outside_disposable_container(self):
        with patch.dict(os.environ, {"SIM_ENV": "aws", "RUN_LOCAL_MYSQL_TESTS": "yes",
                                      "SIM_DB_HOST": "mysql", "SIM_REPL_HOST": "mysql",
                                      "SIM_CDC_HOST": "mysql"}, clear=True):
            with self.assertRaisesRegex(SystemExit, "Local-only"):
                main()

    def test_probe_never_prints_connection_exception_message(self):
        def bad():
            raise RuntimeError("secret_password=do_not_log host=do_not_log")
        output = io.StringIO()
        with redirect_stdout(output):
            ok = _stage("safe_probe_name", bad)
        self.assertFalse(ok)
        self.assertIn('"error_type": "RuntimeError"', output.getvalue())
        self.assertNotIn("do_not_log", output.getvalue())
