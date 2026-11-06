"""Validate the CDC stream constructor against the installed replication library.

This is a compatibility contract: unsupported keyword arguments must fail in
tests before a live binlog consumer is ever launched.
"""
import ast
import importlib.util
import inspect
import os
from pathlib import Path
import unittest


class BinlogReaderConstructorContract(unittest.TestCase):
    def test_cdc_reader_kwargs_supported_by_installed_library(self):
        if importlib.util.find_spec("pymysqlreplication") is None:
            if os.environ.get("SIM_ENV") == "local":
                self.fail("mysql-replication must be installed in Docker tests")
            self.skipTest("mysql-replication not installed on host")

        from pymysqlreplication import BinLogStreamReader
        source = (Path(__file__).resolve().parents[1] / "runtime" / "cdc.py").read_text(
            encoding="utf-8"
        )
        module = ast.parse(source)
        reader_calls = [
            node for node in ast.walk(module)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Name)
            and node.func.id == "BinLogStreamReader"
        ]
        self.assertEqual(len(reader_calls), 1)
        kwargs = {kw.arg for kw in reader_calls[0].keywords if kw.arg is not None}
        params = set(inspect.signature(BinLogStreamReader).parameters)
        self.assertFalse(kwargs - params, f"Unsupported BinLogStreamReader kwargs: {kwargs - params}")
        # Safety filters and checkpoint are mandatory, not optional.
        required = {"connection_settings", "server_id", "only_schemas",
                    "only_tables", "only_events", "resume_stream",
                    "log_file", "log_pos", "freeze_schema"}
        self.assertFalse(required - kwargs, f"Missing CDC stream safeguards: {required - kwargs}")


if __name__ == "__main__":
    unittest.main()
