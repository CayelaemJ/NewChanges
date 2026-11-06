import unittest
from unittest.mock import patch, Mock
from runtime.cdc import apply_change, bootstrap_empty_source, CdcReadinessError, CdcBootstrapStageError, preflight

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

class CdcReadinessDiagnostics(unittest.TestCase):
    def test_only_fixed_safe_codes_are_allowed(self):
        with self.assertRaisesRegex(ValueError, "Unsupported CDC diagnostic"):
            CdcReadinessError("password=secret")
        self.assertEqual(
            CdcReadinessError("CDC_LOG_CONFIG_UNSUPPORTED").code,
            "CDC_LOG_CONFIG_UNSUPPORTED")

    def test_binlog_preflight_reports_specific_nonsecret_reason(self):
        replica = Mock()
        with patch("runtime.cdc.connect", return_value=replica), patch(
            "runtime.cdc.query", return_value=[(0, "ROW", "FULL")]
        ):
            with self.assertRaises(CdcReadinessError) as raised:
                preflight()
        self.assertEqual(raised.exception.code, "CDC_LOG_CONFIG_UNSUPPORTED")
        replica.close.assert_called_once()

    def test_empty_bootstrap_refuses_active_writer_with_safe_code(self):
        source, sink = Mock(), Mock()
        with patch.dict("os.environ", {"SIM_CDC_BOOTSTRAP_APPROVED": "YES_EMPTY_SOURCE_ONLY"}), patch(
            "runtime.cdc.connect", side_effect=[source, sink]
        ), patch("runtime.cdc.query", return_value=[(1,)]):
            with self.assertRaises(CdcReadinessError) as raised:
                bootstrap_empty_source()
        self.assertEqual(raised.exception.code, "CDC_SIMULATION_NOT_STOPPED")
        sink.rollback.assert_called_once()
        source.close.assert_called_once()
        sink.close.assert_called_once()

    def test_empty_bootstrap_refuses_existing_rows_with_safe_code(self):
        source, sink = Mock(), Mock()
        with patch.dict("os.environ", {"SIM_CDC_BOOTSTRAP_APPROVED": "YES_EMPTY_SOURCE_ONLY"}), patch(
            "runtime.cdc.connect", side_effect=[source, sink]
        ), patch("runtime.cdc.query", side_effect=[[(0,)], [(1,)]]):
            with self.assertRaises(CdcReadinessError) as raised:
                bootstrap_empty_source()
        self.assertEqual(raised.exception.code, "CDC_SOURCE_NOT_EMPTY")
        sink.rollback.assert_called_once()

class CdcBootstrapStageTests(unittest.TestCase):
    def test_unexpected_source_connect_runtime_error_has_safe_stage(self):
        with patch.dict("os.environ", {"SIM_CDC_BOOTSTRAP_APPROVED": "YES_EMPTY_SOURCE_ONLY"}), patch(
            "runtime.cdc.connect", side_effect=RuntimeError("secret-password-string")
        ):
            with self.assertRaises(CdcBootstrapStageError) as raised:
                bootstrap_empty_source()
        self.assertEqual(raised.exception.stage, "SOURCE_CONNECT")
        self.assertNotIn("secret-password-string", str(raised.exception))

    def test_unexpected_sink_connect_runtime_error_closes_source(self):
        src = Mock()
        with patch.dict("os.environ", {"SIM_CDC_BOOTSTRAP_APPROVED": "YES_EMPTY_SOURCE_ONLY"}), patch(
            "runtime.cdc.connect", side_effect=[src, RuntimeError("do_not_log_host")]
        ):
            with self.assertRaises(CdcBootstrapStageError) as raised:
                bootstrap_empty_source()
        self.assertEqual(raised.exception.stage, "SINK_CONNECT")
        self.assertNotIn("do_not_log_host", str(raised.exception))
        src.close.assert_called_once()
