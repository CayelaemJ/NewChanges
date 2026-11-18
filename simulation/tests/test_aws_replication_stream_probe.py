"""Offline-only safety tests of AWS bounded replication probe."""
import unittest
from unittest.mock import MagicMock, patch
from ops.aws_replication_stream_probe import probe_config, probe_stream

CONFIG = {
    "host": "testing.abc.eu-north-1.rds.amazonaws.com",
    "port": 3306, "user": "fixer_cdc_stream",
    "password": "UNIT_TEST_PASSWORD_ONLY", "ca": "/tmp/unit-test-ca.pem",
}


class FakeReader:
    def __init__(self, **kwargs):
        self.kwargs = kwargs
        self.closed = False

    def __iter__(self):
        return iter([])

    def close(self):
        self.closed = True


class AwsReplicationProbeTests(unittest.TestCase):
    def test_probe_requires_explicit_approval(self):
        with self.assertRaisesRegex(ValueError,"APPROVAL"):
            probe_config({})

    def test_rejects_non_dedicated_user_before_connection(self):
        with self.assertRaisesRegex(ValueError,"DEDICATED"):
            probe_config({
                "FIXER_CDC_STREAM_PROBE_APPROVED":
                    "YES_BOUNDED_AWS_STREAM_PROBE_NO_PERSISTENCE",
                "FIXER_RDS_TEST_USER":"fixeradmin",
            })

    def test_rejects_unsafe_server_id(self):
        for value in ("0", "-1", "4294967296", "not-an-id"):
            with self.subTest(value=value), self.assertRaisesRegex(
                ValueError,"SERVER_ID"
            ):
                probe_config({
                    "FIXER_CDC_STREAM_PROBE_APPROVED":
                        "YES_BOUNDED_AWS_STREAM_PROBE_NO_PERSISTENCE",
                    "FIXER_RDS_TEST_USER":"fixer_cdc_stream",
                    "FIXER_CDC_PROBE_SERVER_ID":value,
                })

    def test_probe_does_not_persist_or_expose_source_rows(self):
        conn=MagicMock()
        cursor=conn.cursor.return_value.__enter__.return_value
        cursor.fetchone.side_effect=[
            ("mysql-bin-changelog.000055",600),
            ("Ssl_cipher","TLS_AES_256_GCM_SHA384"),
        ]
        cursor.fetchall.return_value=[("mysql-bin-changelog.000055",1000)]
        observed=[]
        def factory(**kwargs):
            instance=FakeReader(**kwargs)
            observed.append(instance)
            return instance
        with patch("pymysql.connect",return_value=conn) as connect:
            result=probe_stream(CONFIG,24137,reader_factory=factory)
        self.assertEqual(result["status"],"PASS")
        self.assertEqual(result["events_observed"],0)
        self.assertFalse(result["checkpoint_created"])
        self.assertFalse(result["cdc_activated"])
        self.assertTrue(observed[0].closed)
        self.assertEqual(observed[0].kwargs["log_pos"],600)
        self.assertEqual(observed[0].kwargs["blocking"],False)
        self.assertTrue(connect.call_args.kwargs["ssl_verify_identity"])
        self.assertTrue(observed[0].kwargs["connection_settings"]["ssl_verify_cert"])
        self.assertTrue(observed[0].kwargs["ctl_connection_settings"]["ssl_verify_identity"])
        self.assertTrue(conn.close.called)
        self.assertNotIn("UNIT_TEST_PASSWORD_ONLY",str(result))
        self.assertEqual(cursor.execute.call_count,3)

    def test_probe_fails_closed_without_binlog(self):
        conn=MagicMock()
        cursor=conn.cursor.return_value.__enter__.return_value
        cursor.fetchone.side_effect=[
            ("mysql-bin-changelog.000055",600),
            ("Ssl_cipher","TLS_AES_256_GCM_SHA384"),
        ]
        cursor.fetchall.return_value=[]
        with patch("pymysql.connect",return_value=conn):
            with self.assertRaisesRegex(RuntimeError,"NO_VERIFIABLE"):
                probe_stream(CONFIG,24137,reader_factory=FakeReader)
        self.assertTrue(conn.close.called)


if __name__=="__main__":
    unittest.main()
