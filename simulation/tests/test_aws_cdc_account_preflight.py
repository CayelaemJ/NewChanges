"""Pure mocked AWS CDC preflight tests; never access AWS."""
import unittest
from unittest.mock import MagicMock
from ops.aws_cdc_account_preflight import audit_cdc_account


def fake_connection(*, tls=True, client=True, schema=True, binlogs=True):
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    grants = [
        "GRANT USAGE ON *.* TO `fixer_cdc_stream`@`%`",
        "GRANT REPLICATION SLAVE ON *.* TO `fixer_cdc_stream`@`%`",
    ]
    if client:
        grants.append("GRANT REPLICATION CLIENT ON *.* TO `fixer_cdc_stream`@`%`")
    if schema:
        grants.append("GRANT SELECT ON `ingest_stage`.* TO `fixer_cdc_stream`@`%`")
    cursor.fetchall.side_effect = [
        [(g,) for g in grants],
        [("mysql-bin-changelog.000055", 123)] if binlogs else [],
        [("log_bin","ON"),("binlog_format","ROW"),("binlog_row_image","FULL")]
    ]
    cursor.fetchone.side_effect = [
        ("mysql-bin-changelog.000055", 123),
        ("Ssl_cipher", "TLS_AES_256_GCM_SHA384" if tls else "")
    ]
    return conn,cursor


class AwsCdcAccountPreflightTests(unittest.TestCase):
    def test_ready_account(self):
        conn,cursor = fake_connection()
        result=audit_cdc_account(conn)
        self.assertEqual(result["status"],"PASS")
        self.assertTrue(all(result["checks"].values()))
        self.assertFalse(result["replication_stream_started"])
        self.assertFalse(result["checkpoint_created"])
        self.assertFalse(result["source_rows_read"])
        self.assertEqual(cursor.execute.call_count,5)

    def test_missing_grant_fails_closed(self):
        conn,_=fake_connection(schema=False)
        result=audit_cdc_account(conn)
        self.assertEqual(result["status"],"REVIEW_REQUIRED")
        self.assertFalse(result["checks"]["source_schema_select"])

    def test_missing_binlog_inventory_fails_closed(self):
        conn,_=fake_connection(binlogs=False)
        result=audit_cdc_account(conn)
        self.assertEqual(result["status"],"REVIEW_REQUIRED")
        self.assertFalse(result["checks"]["binlog_inventory_nonempty"])

    def test_empty_tls_cipher_fails_closed(self):
        conn,_=fake_connection(tls=False)
        result=audit_cdc_account(conn)
        self.assertEqual(result["status"],"REVIEW_REQUIRED")
        self.assertFalse(result["checks"]["tls_cipher_negotiated"])

    def test_no_replication_client_fails_closed(self):
        conn,_=fake_connection(client=False)
        self.assertEqual(audit_cdc_account(conn)["status"],"REVIEW_REQUIRED")


if __name__ == "__main__":
    unittest.main()
