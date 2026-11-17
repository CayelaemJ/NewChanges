"""Opt-in, bounded AWS RDS replication-protocol probe — NOT live CDC.

May receive transient source row images in process memory: approval is mandatory.
Never logs row contents, saves events, creates a checkpoint, or mutates the source.
Starts at *current* SHOW BINARY LOG STATUS for a connectivity test ONLY.
That coordinate is NEVER a valid durable CDC bootstrap and must not be reused.
"""
import json
import os
import re
import sys
import time

from ops.aws_test_readiness import safe_failure_code, validate_environment
from runtime.ingest_stage_contract import FEED_TABLES

_APPROVAL = "YES_BOUNDED_AWS_STREAM_PROBE_NO_PERSISTENCE"


def probe_config(environ=None):
    env = dict(os.environ if environ is None else environ)
    if env.get("FIXER_CDC_STREAM_PROBE_APPROVED") != _APPROVAL:
        raise ValueError("STREAM_PROBE_APPROVAL_REQUIRED")
    if env.get("FIXER_RDS_TEST_USER") != "fixer_cdc_stream":
        raise ValueError("DEDICATED_CDC_ACCOUNT_REQUIRED")
    server_id = env.get("FIXER_CDC_PROBE_SERVER_ID", "")
    if not re.fullmatch(r"[1-9][0-9]{0,9}", server_id):
        raise ValueError("UNIQUE_REPLICATION_SERVER_ID_REQUIRED")
    server_id = int(server_id)
    if not 1 <= server_id <= 4294967295:
        raise ValueError("UNIQUE_REPLICATION_SERVER_ID_REQUIRED")
    env["FIXER_AWS_TEST_READONLY_APPROVED"] = "YES_METADATA_ONLY"
    env["FIXER_RDS_TEST_PASSWORD"] = env.get("FIXER_CDC_PASSWORD", "")
    config = validate_environment(env)
    return config, server_id


def probe_stream(config, server_id, *, reader_factory=None, clock=time.monotonic):
    """Read at most 10 events; never persist/use today's coordinate as baseline."""
    import pymysql
    from pymysqlreplication import BinLogStreamReader
    from pymysqlreplication.event import XidEvent
    from pymysqlreplication.row_event import (
        WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent,
    )

    settings = {
        "host": config["host"], "port": config["port"], "user": config["user"],
        "password": config["password"], "ssl_ca": config["ca"],
        "ssl_verify_cert": True, "ssl_verify_identity": True,
        "connect_timeout": 5, "read_timeout": 4, "write_timeout": 4,
    }
    sql = pymysql.connect(**settings)
    try:
        with sql.cursor() as cursor:
            cursor.execute("SHOW BINARY LOG STATUS")
            status = cursor.fetchone()
            cursor.execute("SHOW BINARY LOGS")
            logs = cursor.fetchall()
            cursor.execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
            cipher = cursor.fetchone()
        if (not status or len(status) < 2 or not isinstance(status[0], str)
                or type(status[1]) is not int or status[1] < 4
                or not logs or not any(row[0] == status[0] for row in logs)):
            raise RuntimeError("NO_VERIFIABLE_LIVE_LOG_COORDINATE")
        if not cipher or not cipher[1]:
            raise RuntimeError("TLS_NOT_NEGOTIATED")
        current_file, current_position = status[:2]
    finally:
        sql.rollback()
        sql.close()

    factory = reader_factory or BinLogStreamReader
    stream = None
    start = clock()
    counts = {"INSERT": 0, "UPDATE": 0, "DELETE": 0, "XID": 0}
    read_events = 0
    try:
        stream = factory(
            connection_settings=settings.copy(),
            ctl_connection_settings=settings.copy(),
            server_id=server_id,
            only_schemas=["ingest_stage"],
            only_tables=sorted(FEED_TABLES),
            only_events=[WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent, XidEvent],
            blocking=False, resume_stream=True,
            log_file=current_file, log_pos=current_position,
            freeze_schema=True, enable_logging=False,
        )
        # Nonblocking reader plus short socket timeout. Even a no-event run
        # must close both replication/control connections.
        iterator = iter(stream)
        for _ in range(10):
            if clock() - start > 15:
                break
            try:
                event = next(iterator)
            except StopIteration:
                break
            read_events += 1
            if isinstance(event, WriteRowsEvent):
                counts["INSERT"] += 1
            elif isinstance(event, UpdateRowsEvent):
                counts["UPDATE"] += 1
            elif isinstance(event, DeleteRowsEvent):
                counts["DELETE"] += 1
            elif isinstance(event, XidEvent):
                counts["XID"] += 1
            else:
                raise RuntimeError("UNEXPECTED_REPLICATION_EVENT")
        return {
            "mode": "AWS_REPLICATION_BOUNDED_CONNECTIVITY_ONLY",
            "status": "PASS",
            "events_observed": read_events,
            "event_types": counts,
            "initial_coordinate_is_not_checkpoint": True,
            "source_rows_saved": False,
            "checkpoint_created": False,
            "dashboard_notifications_sent": False,
            "cdc_activated": False,
        }
    finally:
        if stream is not None:
            stream.close()


def main():
    try:
        config, sid = probe_config()
        result = probe_stream(config, sid)
        print(json.dumps(result, sort_keys=True))
        return 0
    except Exception as exc:
        if type(exc) is ValueError and str(exc) in {
            "STREAM_PROBE_APPROVAL_REQUIRED",
            "DEDICATED_CDC_ACCOUNT_REQUIRED",
            "UNIQUE_REPLICATION_SERVER_ID_REQUIRED",
        }:
            code = str(exc)
        elif type(exc) is RuntimeError and str(exc) in {
            "NO_VERIFIABLE_LIVE_LOG_COORDINATE",
            "TLS_NOT_NEGOTIATED", "UNEXPECTED_REPLICATION_EVENT",
        }:
            code = str(exc)
        else:
            code = safe_failure_code(exc)
        print(json.dumps({
            "mode": "AWS_REPLICATION_BOUNDED_CONNECTIVITY_ONLY",
            "status": "FAILED", "reason_code": code,
            "cdc_activated": False,
        }, sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
