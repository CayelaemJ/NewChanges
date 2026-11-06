import unittest
from unittest.mock import patch
from runtime.cdc import apply_change, bootstrap_empty_source

class CdcGuard(unittest.TestCase):
    def test_requires_bootstrap_approval(self):
        with patch.dict('os.environ',{},clear=True):
            with self.assertRaises(RuntimeError):bootstrap_empty_source()
    def test_foreign_table_never_written(self):
        with self.assertRaises(ValueError):
            apply_change(None,'production_users','INSERT',None,{'id':1},'k','f',4,0,None)
    def test_unknown_operation_refused(self):
        with self.assertRaises(ValueError):
            apply_change(None,'orders','TRUNCATE',None,{'id':1},'k','f',4,0,None)
