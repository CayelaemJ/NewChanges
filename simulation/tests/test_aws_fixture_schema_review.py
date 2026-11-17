"""Offline tests of synthetic-fixture schema feasibility; NO AWS credentials."""
import unittest
from unittest.mock import MagicMock

from ops.aws_fixture_schema_review import inspect_fixture_feasibility
from runtime.ingest_stage_contract import FEED_TABLES


def fake_db(*, required_more=False, triggers=False, foreign_key=False):
    conn=MagicMock()
    cursor=conn.cursor.return_value.__enter__.return_value
    cols=[]
    for table in sorted(FEED_TABLES):
        cols.extend([
            (table,"_ingest_id","bigint","NO",None,"PRI","",""),
            (table,"source_updated_at","text","YES",None,"","",""),
            (table,"_source_updated_utc","datetime","YES",None,"","VIRTUAL GENERATED","str_to_date(...)")
        ])
        if required_more and table=="employees":
            cols.append((table,"staff_id","varchar","NO",None,"","",""))
    constraints=[(t,"PRIMARY","PRIMARY KEY") for t in sorted(FEED_TABLES)]
    if foreign_key:
        constraints.append(("employees","fk_external","FOREIGN KEY"))
    cursor.fetchall.side_effect=[cols,constraints,[( "employees", 1)] if triggers else []]
    return conn,cursor


class FixtureSchemaReviewTests(unittest.TestCase):
    def test_no_source_row_queries_or_writes(self):
        conn,cur=fake_db()
        result=inspect_fixture_feasibility(conn)
        self.assertEqual(result["status"],"PASS")
        self.assertEqual(len(result["feeds"]),10)
        self.assertFalse(result["aws_writes_performed"])
        self.assertFalse(result["source_rows_read"])
        self.assertFalse(result["test_fixture_authorized"])
        self.assertTrue(all(not x["safe_to_write"] for x in result["feeds"].values()))
        self.assertEqual(cur.execute.call_count,3)
        for call in cur.execute.call_args_list:
            q=call.args[0].upper()
            self.assertIn("INFORMATION_SCHEMA",q)
            self.assertNotIn("INSERT INTO INGEST_STAGE",q)
            self.assertNotIn("DELETE FROM INGEST_STAGE",q)

    def test_required_fields_flagged_without_leaking_names(self):
        conn,_=fake_db(required_more=True)
        result=inspect_fixture_feasibility(conn)
        self.assertEqual(result["feeds"]["employees"]["required_without_default"],2)
        self.assertNotIn("staff_id",str(result))

    def test_trigger_and_foreign_key_are_highlighted(self):
        conn,_=fake_db(triggers=True,foreign_key=True)
        result=inspect_fixture_feasibility(conn)
        self.assertTrue(result["feeds"]["employees"]["triggers_present"])
        self.assertTrue(result["feeds"]["employees"]["foreign_key_constraints_present"])
        self.assertFalse(result["feeds"]["employees"]["safe_to_write"])

    def test_missing_ingest_id_primary_key_blocks_pass(self):
        conn,cur=fake_db()
        data=cur.fetchall.side_effect
        cols,cons,trigs=data
        cols=[(t,n,typ,nullable,default,("" if t=="employees" and n=="_ingest_id" else key),extra,expr)
              for t,n,typ,nullable,default,key,extra,expr in cols]
        cur.fetchall.side_effect=[cols,cons,trigs]
        result=inspect_fixture_feasibility(conn)
        self.assertEqual(result["status"],"REVIEW_REQUIRED")


if __name__=="__main__":
    unittest.main()
