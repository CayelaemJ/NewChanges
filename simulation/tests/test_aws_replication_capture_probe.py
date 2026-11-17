"""Mock-only read-only current log replay test; no external connections."""
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock
from ops.aws_replication_capture_probe import replay_current_log

FILE="mysql-bin-changelog.000055"
CONFIG={"host":"test.example.invalid","port":3306,"user":"fixer_cdc_stream",
        "password":"TEST_ONLY_SECRET","ca":"/test-ca.pem"}


def event(kind):
    from pymysqlreplication.event import XidEvent
    from pymysqlreplication.row_event import WriteRowsEvent,UpdateRowsEvent
    # Construct without parsing binary log values; instance checks use actual class.
    cls={"XID":XidEvent,"INSERT":WriteRowsEvent,"UPDATE":UpdateRowsEvent}[kind]
    return object.__new__(cls)


def connection():
    db=MagicMock()
    cur=db.cursor.return_value.__enter__.return_value
    cur.fetchone.side_effect=[
        (FILE,700),("Ssl_cipher","TLS_AES_256_GCM_SHA384")
    ]
    cur.fetchall.return_value=[(FILE,700)]
    return db


class Reader:
    def __init__(self, events, **settings):
        self.settings=settings
        self.events=events
        self.closed=False
    def __iter__(self):
        return iter(self.events)
    def close(self):
        self.closed=True


class CaptureTests(unittest.TestCase):
    def test_row_plus_xid_is_capture_verified_not_live_cdc(self):
        db=connection()
        reader=[]
        def factory(**settings):
            obj=Reader([event("INSERT"),event("XID")],**settings)
            reader.append(obj)
            return obj
        result=replay_current_log(CONFIG,24137,connection_factory=lambda **_:db,
                                  reader_factory=factory)
        self.assertEqual(result["status"],"CAPTURE_VERIFIED")
        self.assertTrue(result["allowlisted_row_commit_observed"])
        self.assertFalse(result["cdc_activated"])
        self.assertFalse(result["checkpoint_created"])
        self.assertTrue(reader[0].closed)
        self.assertEqual(reader[0].settings["log_pos"],4)
        self.assertTrue(reader[0].settings["connection_settings"]["ssl_verify_identity"])
        self.assertNotIn("TEST_ONLY_SECRET",str(result))

    def test_empty_log_is_inconclusive_not_pass(self):
        db=connection()
        result=replay_current_log(CONFIG,24137,connection_factory=lambda **_:db,
                                  reader_factory=lambda **kw:Reader([],**kw))
        self.assertEqual(result["status"],"INCONCLUSIVE_NO_COMMITTED_ROW")

    def test_xid_without_row_is_inconclusive(self):
        db=connection()
        result=replay_current_log(CONFIG,24137,connection_factory=lambda **_:db,
             reader_factory=lambda **kw:Reader([event("XID")],**kw))
        self.assertEqual(result["status"],"INCONCLUSIVE_NO_COMMITTED_ROW")

    def test_row_without_xid_is_inconclusive(self):
        db=connection()
        result=replay_current_log(CONFIG,24137,connection_factory=lambda **_:db,
             reader_factory=lambda **kw:Reader([event("UPDATE")],**kw))
        self.assertEqual(result["status"],"INCONCLUSIVE_NO_COMMITTED_ROW")

    def test_fails_closed_when_log_missing(self):
        db=connection()
        cur=db.cursor.return_value.__enter__.return_value
        cur.fetchall.return_value=[]
        with self.assertRaisesRegex(RuntimeError,"NO_VERIFIED"):
            replay_current_log(CONFIG,24137,connection_factory=lambda **_:db,
                               reader_factory=lambda **kw:Reader([],**kw))
        self.assertTrue(db.close.called)


if __name__=="__main__":
    unittest.main()
