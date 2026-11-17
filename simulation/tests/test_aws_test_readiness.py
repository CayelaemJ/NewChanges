"""Unit-only safety and inventory tests; no AWS network requests."""
import os
import ssl
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from ops.aws_test_readiness import FEED_TABLES, inspect, validate_environment, safe_failure_code


class AwsReadinessTests(unittest.TestCase):
    def test_no_connection_without_exact_approval(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "APPROVAL_REQUIRED"):
                validate_environment()

    def test_reject_fake_host_admin_account_or_missing_tls(self):
        with tempfile.NamedTemporaryFile() as cert:
            good = {
                "FIXER_AWS_TEST_READONLY_APPROVED": "YES_METADATA_ONLY",
                "FIXER_RDS_TEST_HOST": "testing.abc.eu-north-1.rds.amazonaws.com",
                "FIXER_RDS_TEST_USER": "cdc_metadata_reader",
                "FIXER_RDS_TEST_PASSWORD": "placeholder-test-only",
                "FIXER_RDS_TEST_CA": cert.name,
            }
            with patch.dict(os.environ, good, clear=True):
                self.assertEqual(validate_environment()["host"], good["FIXER_RDS_TEST_HOST"])
            for key, value in (
                ("FIXER_RDS_TEST_HOST", "localhost"),
                ("FIXER_RDS_TEST_HOST", "server.example.org"),
                ("FIXER_RDS_TEST_USER", "root"),
                ("FIXER_RDS_TEST_USER", "admin"),
                ("FIXER_RDS_TEST_CA", "/nonexistent/ca.pem"),
                ("FIXER_RDS_TEST_PORT", "0"),
            ):
                with self.subTest(key=key), patch.dict(
                    os.environ, dict(good, **{key: value}), clear=True
                ):
                    with self.assertRaises(RuntimeError):
                        validate_environment()

    def test_inspection_uses_only_metadata_and_configuration(self):
        db = MagicMock()
        cursor = db.cursor.return_value.__enter__.return_value
        cursor.fetchall.side_effect = [
            [("v_employees", "VIEW"), ("v_debt_accounts", "VIEW")],
            [("v_employees", "source_updated_at"),
             ("v_employees", "employer_ref"),
             ("employees", "_ingest_id")],
            [("log_bin", "ON"), ("binlog_format", "ROW"),
             ("binlog_row_image", "FULL")],
        ]
        result = inspect(db)
        self.assertEqual(len(result["view_inventory"]), len(FEED_TABLES))
        self.assertTrue(result["view_inventory"]["employees"]["view_present"])
        self.assertFalse(result["view_inventory"]["policies"]["view_present"])
        self.assertTrue(all(result["binlog"].values()))
        self.assertEqual(result["aws_live_cdc"], "NOT_ENABLED")
        statements = [call.args[0].upper() for call in cursor.execute.call_args_list]
        self.assertEqual(len(statements), 3)
        self.assertTrue(all("INFORMATION_SCHEMA" in sql or sql.startswith("SHOW GLOBAL VARIABLES")
                            for sql in statements))
        self.assertTrue(all(not any(token in sql for token in
                            ("INSERT INTO", "UPDATE ", "DELETE FROM", "DROP ", "CREATE ", "CALL "))
                            for sql in statements))

    def test_safe_diagnostic_codes_never_echo_server_exception_text(self):
        self.assertEqual(
            safe_failure_code(ModuleNotFoundError("No module named pymysql")),
            "PYMYSQL_NOT_INSTALLED_IN_ACTIVE_PYTHON"
        )
        self.assertEqual(
            safe_failure_code(RuntimeError("AWS_TEST_TLS_CA_MISSING")),
            "AWS_TEST_TLS_CA_MISSING"
        )
        self.assertEqual(
            safe_failure_code(RuntimeError("password=secret db.example.com")),
            "RDS_READONLY_PROBE_FAILED_UNCLASSIFIED"
        )
        wrapped_tls = ssl.SSLCertVerificationError(1, "sensitive hostname")
        wrapped = Exception(2003, "MySQL connection failed")
        wrapped.__cause__ = wrapped_tls
        self.assertEqual(safe_failure_code(wrapped),
                         "RDS_TLS_CERTIFICATE_VERIFICATION_FAILED")
        tls = ssl.SSLError(1, "certificate sensitive details")
        wrapped.__cause__ = tls
        self.assertEqual(safe_failure_code(wrapped),
                         "RDS_TLS_CERTIFICATE_OR_HANDSHAKE_FAILED")
        for number, expected in (
            (1045, "RDS_AUTHENTICATION_OR_DATABASE_ACCESS_DENIED"),
            (2003, "RDS_NETWORK_DNS_OR_CONNECTION_FAILED"),
            (2026, "RDS_TLS_CERTIFICATE_OR_HANDSHAKE_FAILED"),
            (1142, "RDS_METADATA_QUERY_PRIVILEGE_DENIED"),
        ):
            with self.subTest(number=number):
                exc = Exception(number, "secret and db hostname")
                self.assertEqual(safe_failure_code(exc), expected)
