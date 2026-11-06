import unittest
from datetime import datetime, timezone
from decimal import Decimal
from unittest.mock import patch

from runtime.logic import allowed_table, choose_historical_time, encode, event_id, schedule_counts
from runtime.common import connection_config, positive_int
from runtime.simulator import run


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

    def test_production_tls_cannot_be_disabled(self):
        with patch.dict('os.environ',{'SIM_ENV':'aws','SIM_DB_HOST':'example.com','SIM_DB_USER':'testwriter',
          'SIM_DB_PASSWORD':'fake-local-password','SIM_DB_DATABASE':'fixer_sim'},clear=True):
            with self.assertRaises(RuntimeError):connection_config()


if __name__=='__main__':unittest.main()
