"""Opt-in bounded read-only replay of the CURRENT AWS binlog file.

Not a CDC bootstrap and not a reliable complete transaction feed. Reads
allowlisted data into transient process memory; never prints row values or
persists source data, checkpoints, or notification generations. An observed
XID plus row event is evidence of transport/capture, NOT deployment readiness.

Starts at pos 4 at the beginning of the CURRENT retained log file to avoid
using an arbitrary mid-event position; this can examine historical source data.
"""
import json
import os
import sys
import time

from ops.aws_replication_stream_probe import probe_config
from ops.aws_test_readiness import safe_failure_code
from runtime.ingest_stage_contract import FEED_TABLES

_REPLAY_APPROVAL = "YES_READ_RETAINED_BINLOG_NO_PERSISTENCE"


def replay_current_log(config, server_id, *, connection_factory=None,
                       reader_factory=None, clock=time.monotonic):
    import pymysql
    from pymysqlreplication import BinLogStreamReader
    from pymysqlreplication.event import XidEvent
    from pymysqlreplication.row_event import (
        WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent,
    )

    settings = {
        "host": config["host"], "port": config["port"],
        "user": config["user"], "password": config["password"],
        "ssl_ca": config["ca"], "ssl_verify_cert": True,
        "ssl_verify_identity": True, "connect_timeout": 5,
        "read_timeout": 4, "write_timeout": 4,
    }
    connect = connection_factory or pymysql.connect
    sql = connect(**settings)
    try:
        with sql.cursor() as cursor:
            cursor.execute("SHOW BINARY LOG STATUS")
            status = cursor.fetchone()
            cursor.execute("SHOW BINARY LOGS")
            listed = cursor.fetchall()
            cursor.execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
            tls = cursor.fetchone()
        if (not status or type(status[0]) is not str
                or type(status[1]) is not int or status[1] < 4
                or not listed or not any(item[0] == status[0] for item in listed)):
            raise RuntimeError("NO_VERIFIED_CURRENT_BINLOG")
        if not tls or not tls[1]:
            raise RuntimeError("TLS_NOT_NEGOTIATED")
        filename = status[0]
    finally:
        sql.rollback()
        sql.close()

    stream = None
    start = clock()
    counts = {"INSERT":0, "UPDATE":0, "DELETE":0, "XID":0}
    seen_row = False
    committed_after_row = False
    events = 0
    try:
        stream = (reader_factory or BinLogStreamReader)(
            connection_settings=settings.copy(),
            ctl_connection_settings=settings.copy(),
            server_id=server_id, only_schemas=["ingest_stage"],
            only_tables=sorted(FEED_TABLES),
            only_events=[WriteRowsEvent,UpdateRowsEvent,DeleteRowsEvent,XidEvent],
            blocking=False, resume_stream=True,
            log_file=filename, log_pos=4,
            freeze_schema=True, enable_logging=False,
        )
        iterator = iter(stream)
        while events < 50 and clock() - start <= 15:
            try:
                event = next(iterator)
            except StopIteration:
                break
            events += 1
            if isinstance(event, WriteRowsEvent):
                counts["INSERT"] += 1
                seen_row = True
            elif isinstance(event, UpdateRowsEvent):
                counts["UPDATE"] += 1
                seen_row = True
            elif isinstance(event, DeleteRowsEvent):
                counts["DELETE"] += 1
                seen_row = True
            elif isinstance(event, XidEvent):
                counts["XID"] += 1
                if seen_row:
                    committed_after_row = True
                    seen_row = False
            else:
                raise RuntimeError("UNKNOWN_REPLICATION_EVENT")
        return {
            "mode":"AWS_CURRENT_LOG_READONLY_REPLAY",
            "status": "CAPTURE_VERIFIED" if committed_after_row else "INCONCLUSIVE_NO_COMMITTED_ROW",
            "events_examined":events, "event_types":counts,
            "allowlisted_row_commit_observed":committed_after_row,
            "replay_coordinate_is_not_checkpoint":True,
            "source_rows_saved":False, "checkpoint_created":False,
            "cdc_activated":False,
        }
    finally:
        if stream is not None:
            stream.close()


def main():
    try:
        if os.environ.get("FIXER_CDC_LOG_REPLAY_APPROVED") != _REPLAY_APPROVAL:
            raise ValueError("RETAINED_LOG_REPLAY_APPROVAL_REQUIRED")
        config, server_id = probe_config()
        result = replay_current_log(config, server_id)
        print(json.dumps(result, sort_keys=True))
        return 0 if result["status"] == "CAPTURE_VERIFIED" else 2
    except Exception as exc:
        code = (str(exc) if str(exc) in {
            "RETAINED_LOG_REPLAY_APPROVAL_REQUIRED",
            "NO_VERIFIED_CURRENT_BINLOG","TLS_NOT_NEGOTIATED",
            "UNKNOWN_REPLICATION_EVENT",
        } else safe_failure_code(exc))
        print(json.dumps({
            "mode":"AWS_CURRENT_LOG_READONLY_REPLAY",
            "status":"FAILED","reason_code":code,
            "cdc_activated":False,"checkpoint_created":False,
        }, sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
