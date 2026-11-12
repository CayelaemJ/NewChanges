"""Regression tests for disposable MySQL role bootstrap SQL formatting."""
import os
import runpy
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

BOOTSTRAP = Path(__file__).resolve().parents[1] / "ops" / "setup_local.py"


class FakeCursor:
    def __init__(self):
        self.commands = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def execute(self, sql, params=None):
        # PyMySQL uses percent formatting for parameterized statements.
        # Account host @'%' must be escaped as @'%%' when binding a password.
        if params is not None:
            sql = sql % tuple(repr(value) for value in params)
        self.commands.append(sql)


class FakeConnection:
    def __init__(self):
        self.cursor_instance = FakeCursor()
        self.closed = False

    def cursor(self):
        return self.cursor_instance

    def close(self):
        self.closed = True


class LocalAccountSetupTests(unittest.TestCase):
    def test_mysql_host_wildcard_is_safe_with_password_binding(self):
        conn = FakeConnection()
        fake_mysql = types.SimpleNamespace(connect=lambda **kwargs: conn)
        env = {
            "SIM_ENV": "local", "SIM_DB_HOST": "mysql", "RUN_LOCAL_MYSQL_TESTS": "yes",
            "MYSQL_ROOT_PASSWORD": "test-root", "SIM_DB_PASSWORD": "test-writer",
            "SIM_CDC_PASSWORD": "test-cdc", "SIM_REPL_PASSWORD": "test-repl",
        }
        with patch.dict(os.environ, env, clear=True), patch.dict(sys.modules, {"pymysql": fake_mysql}):
            runpy.run_path(str(BOOTSTRAP), run_name="__main__")
        self.assertTrue(conn.closed)
        statements = conn.cursor_instance.commands
        creations = [sql for sql in statements if sql.startswith("CREATE USER")]
        self.assertEqual(len(creations), 3)
        self.assertTrue(all("@'%' IDENTIFIED BY" in sql for sql in creations))
        # Verify exact least-privilege grants, not a brittle statement count.
        # The dedicated local CDC account needs the isolated marker sink;
        # it must never get access to the real ingest_stage schema.
        grants = [sql for sql in statements if sql.startswith("GRANT ")]
        self.assertCountEqual(grants, [
            "GRANT SELECT, INSERT, UPDATE, DELETE ON fixer_sim.* TO 'sim_writer'@'%'",
            "GRANT SELECT, INSERT, UPDATE, DELETE ON fixer_sim_analytics.* TO 'sim_cdc'@'%'",
            "GRANT SELECT, INSERT, UPDATE, DELETE ON fixer_ingest_cdc.* TO 'sim_cdc'@'%'",
            "GRANT SELECT ON fixer_sim.* TO 'sim_repl'@'%'",
            "GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'sim_repl'@'%'",
        ])
        self.assertFalse(any("ingest_stage." in grant for grant in grants))
        self.assertEqual(statements[-1], "FLUSH PRIVILEGES")

    def test_bootstrap_fails_closed_outside_local(self):
        conn = FakeConnection()
        fake_mysql = types.SimpleNamespace(connect=lambda **kwargs: conn)
        with patch.dict(os.environ, {
            "SIM_ENV": "prod", "SIM_DB_HOST": "mysql", "RUN_LOCAL_MYSQL_TESTS": "yes",
        }, clear=True), patch.dict(sys.modules, {"pymysql": fake_mysql}):
            with self.assertRaisesRegex(SystemExit, "Refusing non-local"):
                runpy.run_path(str(BOOTSTRAP), run_name="__main__")
        self.assertEqual(conn.cursor_instance.commands, [])
