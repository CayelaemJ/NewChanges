"""Offline-only tests of AWS binlog inventory inspection."""
import unittest
from unittest.mock import MagicMock

from ops.aws_binlog_inventory import inspect_binlog_inventory


def connection(*, tls=True, current=True, empty=False):
    conn = MagicMock()
    cursor = conn.cursor.return_value.__enter__.return_value
    cursor.fetchall.return_value = [] if empty else [
        ("mysql-bin-changelog.000055", 200000),
        ("mysql-bin-changelog.000056", 157),
    ]
    cursor.fetchone.side_effect = [
        ("mysql-bin-changelog.000056" if current else
         "mysql-bin-changelog.999999", 157),
        ("Ssl_cipher", "TLS_AES_256_GCM_SHA384" if tls else ""),
    ]
    return conn, cursor


class BinlogInventoryTests(unittest.TestCase):
    def test_metadata_only_inventory(self):
        conn, cursor = connection()
        result = inspect_binlog_inventory(conn)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(result["retained_log_count"], 2)
        self.assertEqual(result["noncurrent_logs"], 1)
        self.assertEqual(result["retained_log_sizes_bytes"]["current"], 157)
        self.assertFalse(result["source_rows_read"])
        self.assertFalse(result["checkpoint_created"])
        self.assertFalse(result["replication_stream_started"])
        self.assertNotIn("mysql-bin-changelog",str(result))
        self.assertEqual(cursor.execute.call_count,3)

    def test_empty_inventory_is_not_success(self):
        conn,_ = connection(empty=True)
        with self.assertRaisesRegex(ValueError,"UNAVAILABLE"):
            inspect_binlog_inventory(conn)

    def test_no_tls_is_rejected(self):
        conn,_ = connection(tls=False)
        with self.assertRaisesRegex(ValueError,"TLS_NOT_NEGOTIATED"):
            inspect_binlog_inventory(conn)

    def test_missing_current_binlog_is_rejected(self):
        conn,_ = connection(current=False)
        with self.assertRaisesRegex(ValueError,"NOT_RETAINED"):
            inspect_binlog_inventory(conn)


if __name__ == "__main__":
    unittest.main()
