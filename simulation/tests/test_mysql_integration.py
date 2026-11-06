"""Integration tests run ONLY against disposable Docker MySQL, never RDS."""
import os
import unittest
from unittest.mock import patch

from runtime.common import connect
from runtime.simulator import run
from runtime.cdc import apply_change, query, write, run as consume_cdc
from runtime.logic import event_id
from datetime import datetime, timezone
import time


@unittest.skipUnless(os.getenv('SIM_ENV')=='local' and os.getenv('RUN_LOCAL_MYSQL_TESTS')=='yes',
                     'Isolated MySQL container required')
class LocalMySQL(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db=connect('writer')
        with cls.db.cursor() as c:c.execute('UPDATE sim_control SET enabled=TRUE WHERE control_id=1')
        cls.db.commit()

    @classmethod
    def tearDownClass(cls):
        with cls.db.cursor() as c:c.execute('UPDATE sim_control SET enabled=FALSE WHERE control_id=1')
        cls.db.commit();cls.db.close()

    def test_fresh_sha2_accounts_can_authenticate(self):
        # MySQL 8.4 defaults to caching_sha2_password. The first connection
        # of each new local account must work, not just a cached root login.
        for role in ("writer", "replica", "cdc"):
            with self.subTest(role=role):
                db = connect(role)
                try:
                    self.assertEqual(query(db, "SELECT 1")[0][0], 1)
                finally:
                    db.close()

    def test_generator_idempotent_and_relationships(self):
        r=run(run_key='test:run:001',seed='test',max_orders=12)
        self.assertIn(r['status'],('SUCCEEDED','ALREADY_APPLIED'))
        self.assertEqual(run(run_key='test:run:001',seed='test',max_orders=12)['status'],'ALREADY_APPLIED')
        with self.db.cursor() as c:
            c.execute('SELECT COUNT(*) FROM orders o LEFT JOIN customers c ON o.customer_id=c.id WHERE c.id IS NULL')
            self.assertEqual(c.fetchone()[0],0)
            c.execute('SELECT COUNT(*) FROM business_events WHERE event_key=%s',('test:run:001:rollback',))
            self.assertEqual(c.fetchone()[0],0)

    def test_source_timestamps_follow_actual_manual_mutation(self):
        # Simulates an interactive DBeaver UPDATE: no updated_at argument is
        # provided, so the table's ON UPDATE clock must record the new time.
        self.assertEqual(query(self.db, "SELECT @@SESSION.time_zone")[0][0], "+00:00")
        with self.db.cursor() as cur:
            cur.execute("""INSERT INTO products
                (sku,product_name,price,inventory)
                VALUES(%s,%s,%s,%s)""",
                ("SYN-TIMESTAMP-CHECK", "Fresh timestamp test", "35.00", 4))
        self.db.commit()
        first = query(self.db,"SELECT updated_at FROM products WHERE sku=%s",
                      ("SYN-TIMESTAMP-CHECK",))[0][0]
        time.sleep(0.03)
        with self.db.cursor() as cur:
            cur.execute("UPDATE products SET inventory=inventory-1 WHERE sku=%s",
                        ("SYN-TIMESTAMP-CHECK",))
        self.db.commit()
        second = query(self.db,"SELECT updated_at FROM products WHERE sku=%s",
                       ("SYN-TIMESTAMP-CHECK",))[0][0]
        self.assertGreater(second, first)
        delta = (datetime.now(timezone.utc).replace(tzinfo=None)-second).total_seconds()
        self.assertTrue(0 <= delta < 30, f"Source update timestamp too stale: {delta}s")
        view_value = query(self.db,"SELECT last_changed_at_utc FROM v_source_freshness "
                           "WHERE source_table='products'")[0][0]
        self.assertGreaterEqual(view_value,second)

    def test_all_mutable_source_entities_have_automatic_updated_at(self):
        tables = ("customers","products","orders","order_items",
                  "payments","financial_transactions","simulation_runs")
        rows = query(self.db,"""SELECT table_name, EXTRA
             FROM information_schema.COLUMNS
             WHERE table_schema='fixer_sim' AND column_name='updated_at'""")
        updated = {name: extra.lower() for name,extra in rows}
        for table in tables:
            with self.subTest(table=table):
                self.assertIn(table,updated)
                self.assertIn("on update",updated[table])

    def test_late_business_date_preserved_with_fresh_write_timestamp(self):
        # Seeded simulator writes a historical business date for late arrivals,
        # but updated_at is still the actual insertion/manipulation time.
        run(run_key='test:timing:late',seed='timing-fixture',max_orders=12)
        rows = query(self.db,"""SELECT ordered_at,updated_at FROM orders
            WHERE order_key LIKE 'SYN-ORDER-test:timing:late-%'
              AND ordered_at < UTC_TIMESTAMP(6) - INTERVAL 1 DAY""")
        self.assertGreater(len(rows),0)
        for ordered_at, updated_at in rows:
            self.assertGreater(updated_at,ordered_at)
            self.assertLess(abs((datetime.now(timezone.utc).replace(
                tzinfo=None)-updated_at).total_seconds()),30)

    def test_real_binlog_end_to_end(self):
        run(run_key='test:real:cdc',seed='cdc-fixture',max_orders=8)
        result = consume_cdc(max_events=1000,max_seconds=30)
        self.assertEqual(result['status'],'SUCCEEDED')
        sink=connect('cdc')
        try:
            self.assertGreater(query(sink,"SELECT COUNT(*) FROM bronze_changes WHERE entity='orders'")[0][0],0)
            self.assertGreater(query(sink,"SELECT COUNT(*) FROM gold_daily_sales")[0][0],0)
            # Real DELETE events must arrive from the binlog, not only the
            # synthetic apply_change fixture in a separate unit test.
            self.assertGreater(query(sink,"SELECT COUNT(*) FROM bronze_changes WHERE entity='financial_transactions' AND operation='DELETE'")[0][0],0)
            checkpoint_before = query(sink, "SELECT log_file,log_pos FROM cdc_checkpoint WHERE consumer_name='fixer-sim-v1'")[0]
            # Replaying without fresh changes must never double-count Bronze.
            bronze_before = query(sink,"SELECT COUNT(*) FROM bronze_changes")[0][0]
            replay = consume_cdc(max_events=1000,max_seconds=30)
            self.assertEqual(replay['status'],'SUCCEEDED')
            self.assertEqual(query(sink,"SELECT COUNT(*) FROM bronze_changes")[0][0],bronze_before)
            checkpoint_after = query(sink, "SELECT log_file,log_pos FROM cdc_checkpoint WHERE consumer_name='fixer-sim-v1'")[0]
            self.assertEqual(checkpoint_before,checkpoint_after)
        finally:sink.close()

    def test_cdc_bronze_dedupe(self):
        # Apply a synthetic row event to an isolated sink and assert deduplication.
        sink=connect('cdc')
        try:
            row={'id':91000001,'sku':'SYN-CDC-TEST','price':'90.00','is_deleted':0}
            now=datetime(2026,11,6)
            key=event_id('synthetic-bin.000001',1234,0)
            self.assertTrue(apply_change(sink,'products','INSERT',None,row,key,'synthetic-bin.000001',1234,0,now))
            sink.commit()
            self.assertFalse(apply_change(sink,'products','INSERT',None,row,key,'synthetic-bin.000001',1234,0,now))
            sink.commit()
            self.assertEqual(query(sink,'SELECT COUNT(*) FROM bronze_changes WHERE event_key=%s',(key,))[0][0],1)
        finally:sink.close()

    def test_cdc_physical_delete_tombstone(self):
        sink=connect('cdc')
        try:
            before={'id':91000002,'sku':'TO-BE-DELETED','price':'10.00'}
            t=datetime(2026,11,6)
            key1=event_id('synthetic-bin.000001',2000,0)
            key2=event_id('synthetic-bin.000001',3000,0)
            apply_change(sink,'products','INSERT',None,before,key1,'synthetic-bin.000001',2000,0,t)
            apply_change(sink,'products','DELETE',before,None,key2,'synthetic-bin.000001',3000,0,t)
            sink.commit()
            self.assertEqual(query(sink,"SELECT is_deleted FROM silver_entity_state WHERE entity='products' AND entity_id=91000002")[0][0],1)
        finally:sink.close()
