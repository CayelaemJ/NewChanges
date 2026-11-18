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




class CheckpointTransactionTests(unittest.TestCase):
    """Scripted SQL connection; fails closed without an AWS connection."""

    def harness(self, lock=(431, 431), row=None, update_rows=1):
        cursor=MagicMock()
        cursor.rowcount=update_rows
        cursor.fetchone.side_effect=[
            lock,
            row if row is not None else
            ("mysql-bin-changelog.003465", 150, 0, 7),
        ]
        db=MagicMock()
        db.cursor.return_value.__enter__.return_value=cursor
        return db,cursor

    def test_commit_success_writes_digest_feed_and_checkpoint(self):
        db,cur=self.harness()
        worker.commit(db,"mysql-bin-changelog.003465",220,
                      {"journeys"},"a"*64,0,7)
        statements=[call.args[0] for call in cur.execute.call_args_list]
        self.assertEqual(len(statements),5)
        self.assertIn("IS_USED_LOCK",statements[0])
        self.assertIn("FOR UPDATE",statements[1])
        self.assertIn("cdc_commit_digest",statements[2])
        self.assertIn("cdc_feed_generation",statements[3])
        self.assertIn("cdc_checkpoint",statements[4])
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    def test_stale_generation_rejected_without_mutation(self):
        db,cur=self.harness(row=("mysql-bin-changelog.003465",150,1,7))
        with self.assertRaisesRegex(RuntimeError,"STALE_WORKER_OR_GENERATION"):
            worker.commit(db,"mysql-bin-changelog.003465",220,
                          {"journeys"},"a"*64,0,7)
        self.assertEqual(cur.execute.call_count,2)
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_old_fence_rejected_without_mutation(self):
        db,cur=self.harness(row=("mysql-bin-changelog.003465",150,0,8))
        with self.assertRaisesRegex(RuntimeError,"STALE_WORKER_OR_GENERATION"):
            worker.commit(db,"mysql-bin-changelog.003465",220,
                          {"journeys"},"a"*64,0,7)
        self.assertEqual(cur.execute.call_count,2)
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_duplicate_or_regressed_coordinate_rejected(self):
        db,cur=self.harness()
        with self.assertRaisesRegex(RuntimeError,"BINLOG_POSITION_REGRESSION"):
            worker.commit(db,"mysql-bin-changelog.003465",150,
                          {"journeys"},"a"*64,0,7)
        self.assertEqual(cur.execute.call_count,2)
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_missing_feed_row_rolls_back_transaction(self):
        db,cur=self.harness()
        counter={"calls":0}
        def handle(sql,*args):
            counter["calls"]+=1
            if "UPDATE fixer_cdc_meta.cdc_feed_generation" in sql:
                cur.rowcount=0
            else:
                cur.rowcount=1
        cur.execute.side_effect=handle
        with self.assertRaisesRegex(RuntimeError,"FEED_GENERATION_ROW_MISSING"):
            worker.commit(db,"mysql-bin-changelog.003465",220,
                          {"journeys"},"a"*64,0,7)
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_idle_rotation_checkpoint_only_no_generation_increment(self):
        db,cur=self.harness(row=("mysql-bin-changelog.003465",150,0,7))
        worker.advance_idle_rotation(
            db,"mysql-bin-changelog.003465","mysql-bin-changelog.003466",0,7)
        statements=[c.args[0] for c in cur.execute.call_args_list]
        self.assertEqual(len(statements),3)
        self.assertIn("IS_USED_LOCK",statements[0])
        self.assertIn("FOR UPDATE",statements[1])
        self.assertIn("binlog_position=4",statements[2])
        self.assertNotIn("generation=generation+1",statements[2])
        self.assertNotIn("cdc_feed_generation",str(statements))
        self.assertNotIn("cdc_commit_digest",str(statements))
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    def test_idle_rotation_rejects_stale_fence(self):
        db,cur=self.harness(row=("mysql-bin-changelog.003465",150,0,8))
        with self.assertRaisesRegex(RuntimeError,"IDLE_ROTATION_STALE_WORKER"):
            worker.advance_idle_rotation(
                db,"mysql-bin-changelog.003465","mysql-bin-changelog.003466",0,7)
        db.commit.assert_not_called()
        db.rollback.assert_called_once()
        self.assertEqual(cur.execute.call_count,2)

    def test_idle_rotation_rejects_regressed_coordinate(self):
        db,cur=self.harness(row=("mysql-bin-changelog.003466",150,0,7))
        with self.assertRaisesRegex(RuntimeError,"IDLE_ROTATION_CHECKPOINT_FILE_INVALID"):
            worker.advance_idle_rotation(
                db,"mysql-bin-changelog.003465","mysql-bin-changelog.003466",0,7)
        db.commit.assert_not_called()
        db.rollback.assert_called_once()

    def test_idle_rotation_rejects_lost_lock(self):
        db,cur=self.harness(lock=(None,431))
        with self.assertRaisesRegex(RuntimeError,"CDC_SOURCE_LOCK_LOST"):
            worker.advance_idle_rotation(
                db,"mysql-bin-changelog.003465","mysql-bin-changelog.003466",0,7)
        db.commit.assert_not_called()
        db.rollback.assert_called_once()
        self.assertEqual(cur.execute.call_count,1)

    def test_resume_increments_fence_only_once(self):
        db=MagicMock()
        cur=MagicMock()
        cur.fetchone.return_value=(551,551)
        cur.rowcount=1
        cur.fetchall.return_value=[(feed,0) for feed in worker.FEEDS]
        db.cursor.return_value.__enter__.return_value=cur
        result=worker.resume(db,(
            worker.SOURCE_ID,"mysql-bin-changelog.003465",150,0,7))
        self.assertEqual(result,("mysql-bin-changelog.003465",150,0,8))
        db.commit.assert_called_once()
        db.rollback.assert_not_called()

    def test_resume_rejects_incomplete_feed_inventory(self):
        db=MagicMock()
        cur=MagicMock()
        cur.fetchone.return_value=(551,551)
        cur.rowcount=1
        cur.fetchall.return_value=[("journeys",0)]
        db.cursor.return_value.__enter__.return_value=cur
        with self.assertRaisesRegex(RuntimeError,"FEED_INVENTORY_INVALID"):
            worker.resume(db,(worker.SOURCE_ID,
                "mysql-bin-changelog.003465",150,0,7))
        db.commit.assert_not_called()
        db.rollback.assert_called_once()


if __name__=="__main__":
    unittest.main(verbosity=2)
