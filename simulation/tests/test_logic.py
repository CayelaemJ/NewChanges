import unittest
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch

from runtime.logic import allowed_table, choose_historical_time, encode, event_id, schedule_counts
from runtime.common import connection_config, positive_int
from runtime.simulator import run, _execute_event, _once


class Helpers(unittest.TestCase):
    def test_event_id_is_deterministic_and_unique_by_row(self):
        self.assertEqual(event_id('mysql-bin.000001',120,0),event_id('mysql-bin.000001',120,0))
        self.assertNotEqual(event_id('mysql-bin.000001',120,0),event_id('mysql-bin.000001',120,1))
        self.assertNotEqual(event_id('mysql-bin.000001',120,0),event_id('mysql-bin.000002',120,0))

    def test_unsafe_table_denied(self):
        with self.assertRaises(ValueError):allowed_table('app_users')

    def test_deterministic_counts_bounded(self):
        now=datetime(2026,11,6,12,tzinfo=timezone.utc)
        self.assertEqual(schedule_counts('123',10,now),schedule_counts('123',10,now))
        self.assertLessEqual(schedule_counts('123',10,now)['orders'],10)
        self.assertLess(schedule_counts('123',10,datetime(2026,11,7,23,tzinfo=timezone.utc))['orders'],
                        schedule_counts('123',10,now)['orders'])

    def test_json_encodes_decimal_and_time(self):
        self.assertIn('"12.20"',encode({'price':Decimal('12.20')}))
        self.assertIn('2026-',encode({'date':datetime(2026,1,1)}))

    def test_bounds(self):
        for value in ['0','-1','201','abc']:
            with self.subTest(value=value):
                with self.assertRaises(ValueError):positive_int(value,'limit',200)

    def test_simulator_fails_closed_without_approval(self):
        with patch.dict('os.environ',{'SIMULATION_WRITES_APPROVED':'no'},clear=True):
            with self.assertRaises(RuntimeError):run('safe-test')

    def test_database_name_is_fixed(self):
        with patch.dict('os.environ',{'SIM_ENV':'local','SIM_DB_HOST':'mysql','SIM_DB_USER':'testwriter',
          'SIM_DB_PASSWORD':'fake-local-password','SIM_DB_DATABASE':'production'},clear=True):
            with self.assertRaises(RuntimeError):connection_config()

    def test_mid_run_emergency_stop_blocks_next_event(self):
        from unittest.mock import Mock
        conn = Mock()
        with patch('runtime.simulator._rows', return_value=[(0,)]), patch('runtime.simulator._once') as once:
            callback = Mock()
            with self.assertRaisesRegex(RuntimeError, 'Emergency stop'):
                _execute_event(conn,'test:blocked','INSERT',datetime(2026,11,6),callback)
            callback.assert_not_called()
            once.assert_not_called()
            conn.rollback.assert_called_once()
            conn.commit.assert_not_called()

    def test_mid_run_missing_control_row_fails_closed(self):
        from unittest.mock import Mock
        conn = Mock()
        with patch('runtime.simulator._rows', return_value=[]):
            with self.assertRaisesRegex(RuntimeError, 'Emergency stop'):
                _execute_event(conn,'test:blocked2','INSERT',datetime(2026,11,6),Mock())
            conn.rollback.assert_called_once()

    def test_database_sessions_are_utc_for_microsecond_audit(self):
        with patch.dict('os.environ',{
            'SIM_ENV':'local','SIM_DB_HOST':'mysql','SIM_DB_USER':'sim_writer',
            'SIM_DB_PASSWORD':'synthetic-password',
            'SIM_DB_DATABASE':'fixer_sim'},clear=True):
            self.assertEqual(connection_config('writer')['init_command'],
                             "SET time_zone = '+00:00'")

    def test_business_event_uses_database_clock_not_historical_anchor(self):
        from unittest.mock import Mock
        fake_db=Mock()
        historical=datetime(2020,1,1)
        with patch('runtime.simulator._sql',return_value=(1,None)) as sql:
            self.assertTrue(_once(fake_db,'synthetic:test','UPDATE',historical))
        query=sql.call_args.args[1]
        params=sql.call_args.args[2]
        self.assertIn('UTC_TIMESTAMP(6)',query)
        self.assertNotIn(historical,params)

    def test_source_schema_has_auto_timestamps_and_freshness_view(self):
        from pathlib import Path
        schema=(Path(__file__).resolve().parents[1] / 'schema' / '001_source.sql')
        # Schema is in the repository, but the Docker test image needs this
        # schema fixture copied in for the same contract check.
        if not schema.exists():
            self.skipTest('schema DDL not mounted in this environment')
        ddl=schema.read_text(encoding='utf-8')
        self.assertGreaterEqual(ddl.count('ON UPDATE CURRENT_TIMESTAMP(6)'),8)
        self.assertIn('v_source_freshness',ddl)

    def test_source_ddl_has_no_duplicate_index_names(self):
        import re
        from pathlib import Path
        schema=Path(__file__).resolve().parents[1] / 'schema' / '001_source.sql'
        if not schema.exists():
            self.skipTest('schema DDL not mounted in this environment')
        ddl=schema.read_text(encoding='utf-8')
        create_tables=re.findall(r'CREATE TABLE IF NOT EXISTS (\\w+)\\s*\\((.*?)\\) ENGINE=InnoDB;',ddl,re.S)
        self.assertGreaterEqual(len(create_tables),8)
        for table, body in create_tables:
            names=re.findall(r'\\bINDEX\\s+(\\w+)\\s*\\(',body)
            with self.subTest(table=table):
                self.assertEqual(len(names),len(set(names)),
                                 f'Duplicate MySQL index in {table}: {names}')

    def test_production_tls_cannot_be_disabled(self):
        with patch.dict('os.environ',{'SIM_ENV':'aws','SIM_DB_HOST':'example.com','SIM_DB_USER':'testwriter',
          'SIM_DB_PASSWORD':'fake-local-password','SIM_DB_DATABASE':'fixer_sim'},clear=True):
            with self.assertRaises(RuntimeError):connection_config()


if __name__=='__main__':unittest.main()
