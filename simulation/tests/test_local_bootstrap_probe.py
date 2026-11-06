"""Nonsecret diagnostics and isolation contract for local CDC bootstrap probe."""
import io
import os
import subprocess
import sys
import unittest
from pathlib import Path
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

    def test_python_module_entrypoint_imports_from_project_root(self):
        # The Docker test invokes this exact module from WORKDIR /app.
        # Running the script by path puts /app/ops first on sys.path and
        # can break imports of the sibling runtime package.
        working_dir = Path(__file__).resolve().parents[1]
        env = {
            "PATH": os.environ.get("PATH", ""),
            "SIM_ENV": "nonlocal",
            "RUN_LOCAL_MYSQL_TESTS": "no",
        }
        result = subprocess.run(
            [sys.executable, "-m", "ops.local_bootstrap_probe"],
            cwd=working_dir, env=env, capture_output=True, text=True,
            timeout=10, check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Local-only bootstrap probe refused", result.stderr)
        self.assertNotIn("ModuleNotFoundError", result.stderr)

    def test_probe_never_prints_connection_exception_message(self):
        def bad():
            raise RuntimeError("secret_password=do_not_log host=do_not_log")
        output = io.StringIO()
        with redirect_stdout(output):
            ok = _stage("safe_probe_name", bad)
        self.assertFalse(ok)
        self.assertIn('"error_type": "RuntimeError"', output.getvalue())
        self.assertNotIn("do_not_log", output.getvalue())
