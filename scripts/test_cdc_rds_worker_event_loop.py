#!/usr/bin/env python3
"""Offline full-loop CDC worker tests: real control flow, synthetic events, no AWS."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase, main
from unittest.mock import patch

path=Path(__file__).resolve().parent/"cdc-rds-staging-manual-worker.py"
spec=importlib.util.spec_from_file_location("cdc_worker_under_test",path)
worker=importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

FIRST="mysql-bin-changelog.003478"
SECOND="mysql-bin-changelog.003479"


def event(kind, **attrs):
    return type(kind, (), {})( ) if not attrs else type(kind, (), {"__init__": lambda self: self.__dict__.update(attrs)})()


def row(kind, table, position):
    return event(kind,schema=worker.SCHEMA,table=table,
                 packet=SimpleNamespace(log_pos=position))


def rotate(name):
    return event("RotateEvent",next_binlog=name.encode("ascii"))


def xid(pos):
    return event("XidEvent",packet=SimpleNamespace(log_pos=pos))


class FullLoopTests(TestCase):
    def test_commit_before_and_after_rotation(self):
        sequence=[
            row("WriteRowsEvent","journeys",110),xid(150),
            rotate(SECOND),
            row("UpdateRowsEvent","employees",50),xid(90),
        ]
        observed=[]
        def record(db,file,pos,feeds,digest,generation,fence):
            observed.append((file,pos,feeds,generation,fence,digest))
        with patch.object(worker,"commit",side_effect=record), \
             patch.object(worker,"advance_idle_rotation") as advance:
            with self.assertRaisesRegex(RuntimeError,"REPLICATION_STREAM_ENDED"):
                worker.consume_events(sequence,object(),FIRST,0,7)
            advance.assert_called_once_with(
                advance.call_args.args[0],FIRST,SECOND,1,7)
        self.assertEqual(len(observed),2)
        self.assertEqual(
            [(x[0],x[1],x[2],x[3],x[4]) for x in observed],
            [(FIRST,150,{"journeys"},0,7),
             (SECOND,90,{"employees"},1,7)]
        )
        self.assertTrue(all(len(x[-1])==64 for x in observed))

    def test_idle_rotation_preserves_generation(self):
        with patch.object(worker,"advance_idle_rotation") as advance, \
             patch.object(worker,"commit") as commit:
            with self.assertRaisesRegex(RuntimeError,"REPLICATION_STREAM_ENDED"):
                worker.consume_events([rotate(SECOND)],object(),FIRST,4,9)
            self.assertEqual(advance.call_count,1)
            self.assertEqual(advance.call_args.args[1:],(FIRST,SECOND,4,9))
            commit.assert_not_called()

    def test_initial_same_file_rotate_does_not_advance_checkpoint(self):
        with patch.object(worker,"advance_idle_rotation") as advance:
            with self.assertRaisesRegex(RuntimeError,"REPLICATION_STREAM_ENDED"):
                worker.consume_events([rotate(FIRST)],object(),FIRST,0,7)
            advance.assert_not_called()

    def test_rotation_checkpoint_failure_prevents_later_transaction(self):
        sequence=[rotate(SECOND),row("WriteRowsEvent","journeys",50),xid(90)]
        with patch.object(worker,"advance_idle_rotation",
                          side_effect=RuntimeError("IDLE_ROTATION_STALE_WORKER")), \
             patch.object(worker,"commit") as commit:
            with self.assertRaisesRegex(RuntimeError,"IDLE_ROTATION_STALE_WORKER"):
                worker.consume_events(sequence,object(),FIRST,0,7)
            commit.assert_not_called()

    def test_accepts_begin_query_before_committed_row_event(self):
        sequence=[event("QueryEvent",query=b"BEGIN"),
                  row("WriteRowsEvent","journeys",110),xid(150)]
        with patch.object(worker,"commit") as commit:
            with self.assertRaisesRegex(RuntimeError,"REPLICATION_STREAM_ENDED"):
                worker.consume_events(sequence,object(),FIRST,0,7)
            commit.assert_called_once()

    def test_rejects_schema_change_query(self):
        sequence=[event("QueryEvent",query=b"ALTER TABLE ingest_stage.journeys ADD COLUMN x INT"),
                  row("WriteRowsEvent","journeys",110),xid(150)]
        with patch.object(worker,"commit") as commit:
            with self.assertRaisesRegex(RuntimeError,"BINLOG_QUERY_EVENT_REQUIRES_SCHEMA_REVIEW"):
                worker.consume_events(sequence,object(),FIRST,0,7)
            commit.assert_not_called()

    def test_rejects_unknown_statement_query_even_outside_allowlist(self):
        with patch.object(worker,"commit") as commit:
            with self.assertRaisesRegex(RuntimeError,"BINLOG_QUERY_EVENT_REQUIRES_SCHEMA_REVIEW"):
                worker.consume_events([event("QueryEvent",query="CREATE VIEW v AS SELECT 1")],
                                      object(),FIRST,0,7)
            commit.assert_not_called()

    def test_rejects_rotation_with_pending_transaction(self):
        sequence=[row("WriteRowsEvent","journeys",110),rotate(SECOND)]
        with patch.object(worker,"commit") as commit:
            with self.assertRaisesRegex(RuntimeError,"ROTATION_WITH_PENDING_TRANSACTION"):
                worker.consume_events(sequence,object(),FIRST,0,7)
            commit.assert_not_called()

    def test_rejects_partial_transaction_at_stream_end(self):
        with patch.object(worker,"commit") as commit:
            with self.assertRaisesRegex(RuntimeError,"REPLICATION_STREAM_ENDED_WITH_PENDING_TRANSACTION"):
                worker.consume_events([row("DeleteRowsEvent","policies",200)],
                                      object(),FIRST,0,7)
            commit.assert_not_called()

    def test_rejects_binlog_rotation_regression(self):
        with patch.object(worker,"commit") as commit:
            with self.assertRaisesRegex(RuntimeError,"BINLOG_ROTATION_REGRESSION"):
                worker.consume_events([rotate("mysql-bin-changelog.003477")],
                                      object(),FIRST,0,7)
            commit.assert_not_called()

    def test_rejects_bad_binlog_filename(self):
        with self.assertRaisesRegex(RuntimeError,"BINLOG_ROTATION_INVALID"):
            worker.consume_events([rotate("other-bin.000001")],object(),FIRST,0,7)

    def test_rejects_nonallowlisted_source(self):
        with patch.object(worker,"commit") as commit:
            with self.assertRaisesRegex(RuntimeError,"UNEXPECTED_SOURCE"):
                worker.consume_events([row("WriteRowsEvent","secret",110)],
                                      object(),FIRST,0,7)
            commit.assert_not_called()

    def test_network_errors_are_retryable(self):
        import pymysql
        for error in (
            pymysql.err.OperationalError(2006,"server went away"),
            pymysql.err.InterfaceError(0,"connection closed"),
            ConnectionError("connection reset"),
            TimeoutError("socket timed out"),
        ):
            with self.subTest(error=type(error).__name__):
                self.assertEqual(worker.worker_exit_code(error),75)

    def test_schema_drift_and_checkpoint_errors_are_permanent(self):
        for reason in (
            "BINLOG_QUERY_EVENT_REQUIRES_SCHEMA_REVIEW",
            "CHECKPOINT_BINLOG_PURGED_OR_INVALID",
            "WORKER_MANUALLY_DISABLED",
            "STALE_WORKER_OR_GENERATION",
            "RDS_IDENTITY_MISMATCH",
        ):
            with self.subTest(reason=reason):
                self.assertEqual(worker.worker_exit_code(RuntimeError(reason)),1)

    def test_unexpected_errors_do_not_restart_automatically(self):
        self.assertEqual(worker.worker_exit_code(ValueError("unexpected state")),1)

    def test_replication_connection_uses_heartbeat_and_bounded_timeout(self):
        settings=worker.stream_connection_settings("test-only-secret")
        self.assertEqual(settings["read_timeout"],35)
        self.assertEqual(settings["connect_timeout"],10)
        self.assertEqual(settings["write_timeout"],15)
        self.assertEqual(settings["ssl"]["check_hostname"],True)
        self.assertEqual(settings["user"],"fixer_cdc_reader")

    def test_disconnect_before_transaction_fails_without_commit(self):
        def disconnected():
            raise ConnectionError("simulated disconnected socket")
            yield
        with patch.object(worker,"commit") as commit:
            with self.assertRaises(ConnectionError):
                worker.consume_events(disconnected(),object(),FIRST,0,7)
            commit.assert_not_called()

    def test_disconnect_during_transaction_fails_without_commit(self):
        def disconnected():
            yield row("WriteRowsEvent","journeys",110)
            raise ConnectionError("simulated disconnected socket")
        with patch.object(worker,"commit") as commit:
            with self.assertRaises(ConnectionError):
                worker.consume_events(disconnected(),object(),FIRST,0,7)
            commit.assert_not_called()

    def test_commit_error_does_not_increment_generation(self):
        sequence=[row("WriteRowsEvent","journeys",110),xid(150),
                  row("WriteRowsEvent","employees",160),xid(200)]
        def failed_commit(*args):
            raise ConnectionError("simulated disconnect")
        with patch.object(worker,"commit",side_effect=failed_commit) as commit:
            with self.assertRaises(ConnectionError):
                worker.consume_events(sequence,object(),FIRST,0,7)
            self.assertEqual(commit.call_count,1)


if __name__=="__main__":
    main(verbosity=2)
