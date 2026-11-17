"""Strictly offline unit tests for isolated synthetic CDC DML orchestration."""
import unittest
from unittest.mock import MagicMock

from runtime.disposable_cdc_mutations import (
    DisposableChangePlan, execute_local_disposable_sequence,
)


def plan(**overrides):
    args=dict(schema="cdc_disposable_fixture",table="employers",
              key=900000000000123,approval="YES_LOCAL_DISPOSABLE_ONLY")
    args.update(overrides)
    return DisposableChangePlan(**args)


class LocalDisposableCdcMutationTests(unittest.TestCase):
    def test_refuses_aws_source_schema(self):
        with self.assertRaisesRegex(ValueError,"isolated"):
            plan(schema="ingest_stage")

    def test_refuses_unapproved_or_unreserved_key(self):
        with self.assertRaisesRegex(ValueError,"approval"):
            plan(approval="YES_METADATA_ONLY")
        with self.assertRaisesRegex(ValueError,"key"):
            plan(key=42)
        with self.assertRaisesRegex(ValueError,"key"):
            plan(key=True)

    def test_refuses_unattested_connection_before_cursor(self):
        conn=MagicMock()
        with self.assertRaisesRegex(RuntimeError,"attestation"):
            execute_local_disposable_sequence(conn,plan())
        conn.cursor.assert_not_called()

    def test_three_distinct_commits_and_no_aws_identifiers(self):
        conn=MagicMock()
        conn.host_is_aws=False
        cursor=conn.cursor.return_value
        cursor.fetchone.return_value=(0,)
        cursor.rowcount=1
        output=execute_local_disposable_sequence(conn,plan())
        self.assertEqual(output["status"],"LOCAL_THREE_COMMITS_EXECUTED")
        self.assertEqual(output["operations"],["INSERT","UPDATE","DELETE"])
        self.assertFalse(output["aws_writes"])
        self.assertEqual(conn.commit.call_count,3)
        queries=[call.args[0] for call in cursor.execute.call_args_list]
        self.assertEqual(len(queries),4)
        self.assertTrue(all("cdc_disposable_fixture.employers" in q for q in queries))
        self.assertFalse(any("ingest_stage." in q for q in queries))
        cursor.close.assert_called_once()

    def test_refuses_row_collision_without_mutating(self):
        conn=MagicMock()
        conn.host_is_aws=False
        cursor=conn.cursor.return_value
        cursor.fetchone.return_value=(1,)
        with self.assertRaisesRegex(ValueError,"not empty"):
            execute_local_disposable_sequence(conn,plan())
        self.assertEqual(cursor.execute.call_count,1)
        conn.commit.assert_not_called()
        conn.rollback.assert_called_once()

    def test_failed_update_does_not_claim_completed_sequence(self):
        conn=MagicMock()
        conn.host_is_aws=False
        cur=conn.cursor.return_value
        cur.fetchone.return_value=(0,)
        index=0
        def execute(*args):
            nonlocal index
            index+=1
            cur.rowcount=0 if index==3 else 1
        cur.execute.side_effect=execute
        with self.assertRaisesRegex(RuntimeError,"UPDATE count mismatch"):
            execute_local_disposable_sequence(conn,plan())
        self.assertEqual(conn.commit.call_count,1)
        conn.rollback.assert_called_once()


if __name__=="__main__":
    unittest.main()
