#!/usr/bin/env python3
"""Offline regression tests for manual worker lock fencing; no AWS access."""
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import MagicMock

PATH=Path(__file__).resolve().parent/"cdc-rds-staging-manual-worker.py"
SPEC=importlib.util.spec_from_file_location("fixer_manual_cdc_worker",PATH)
worker=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


class LockFenceTests(unittest.TestCase):
    def cursor(self, owner, current):
        cursor=MagicMock()
        cursor.fetchone.return_value=(owner,current)
        return cursor

    def test_lock_owned_by_same_connection(self):
        cursor=self.cursor(431,431)
        worker.assert_lock_owner(cursor)
        cursor.execute.assert_called_once_with(
            "SELECT IS_USED_LOCK(%s), CONNECTION_ID()", (worker.LOCK_NAME,)
        )

    def test_missing_lock_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError,"CDC_SOURCE_LOCK_LOST"):
            worker.assert_lock_owner(self.cursor(None,431))

    def test_lock_owned_by_another_connection_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError,"CDC_SOURCE_LOCK_LOST"):
            worker.assert_lock_owner(self.cursor(432,431))

    def test_commit_refuses_lost_lock_before_any_mutation(self):
        db=MagicMock()
        cursor=self.cursor(None,431)
        db.cursor.return_value.__enter__.return_value=cursor
        with self.assertRaisesRegex(RuntimeError,"CDC_SOURCE_LOCK_LOST"):
            worker.commit(db,"mysql-bin-changelog.003465",545,
                          {"journeys"},"a"*64,0,1)
        self.assertEqual(cursor.execute.call_count,1)
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_worker_disabled_without_explicit_approval(self):
        import os
        from unittest.mock import patch
        with patch.dict(os.environ,{"FIXER_CDC_WORKER_ACTIVATE":""}):
            with self.assertRaisesRegex(RuntimeError,"WORKER_MANUALLY_DISABLED"):
                worker.run()


if __name__=="__main__":
    unittest.main(verbosity=2)
