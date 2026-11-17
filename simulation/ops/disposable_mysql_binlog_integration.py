"""Opt-in disposable MySQL 8.4 ROW/FULL binlog capture integration.

ONLY localhost isolated Docker fixture. Captures real Write/Update/DeleteRowsEvent
and XidEvent using mysql-replication; persists metadata-only generations to a
temporary SQLite file. NEVER reads AWS or customer tables. Does NOT exercise
the separate TypeScript shared MySQL writer or a browser SSE connection.
"""
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from runtime.aws_binlog_event_adapter import accept_parsed_event
from runtime.aws_notification_bridge import NotificationTransactionBridge
from runtime.aws_notification_contract import (
    NotificationBaseline, source_contract_fingerprint,
)
from runtime.aws_notification_sqlite import SqliteNotificationStore


def _environment():
    if os.environ.get("FIXER_CDC_DISPOSABLE_MYSQL_TEST") != "I_ACCEPT_LOCAL_CONTAINER_ONLY":
        raise ValueError("CDC_BINLOG_DISPOSABLE_APPROVAL_REQUIRED")
    if os.environ.get("FIXER_CDC_TEST_HOST") != "127.0.0.1":
        raise ValueError("CDC_BINLOG_LOCALHOST_ONLY")
    if not re.fullmatch(r"fixer-cdc-test-[0-9a-f]{16,64}",
                        os.environ.get("FIXER_CDC_TEST_CONTAINER", "")):
        raise ValueError("CDC_BINLOG_DISPOSABLE_CONTAINER_REQUIRED")
    port = os.environ.get("FIXER_CDC_TEST_PORT", "")
    if not port.isdecimal() or not 1024 <= int(port) <= 65535:
        raise ValueError("CDC_BINLOG_LOCAL_PORT_REQUIRED")
    password = os.environ.get("FIXER_CDC_TEST_PASSWORD", "")
    if not password.startswith("local-only-") or len(password) < 30:
        raise ValueError("CDC_BINLOG_DISPOSABLE_CREDENTIAL_REQUIRED")
    return {
        "host": "127.0.0.1", "port": int(port),
        "user": "root", "passwd": password,
        "charset": "utf8mb4",
    }


def _source(connection):
    with connection.cursor() as cursor:
        cursor.execute("SHOW VARIABLES LIKE 'binlog_format'")
        if cursor.fetchone()[1].upper() != "ROW":
            raise ValueError("CDC_BINLOG_ROW_REQUIRED")
        cursor.execute("SHOW VARIABLES LIKE 'binlog_row_image'")
        if cursor.fetchone()[1].upper() != "FULL":
            raise ValueError("CDC_BINLOG_FULL_REQUIRED")
        cursor.execute("SELECT @@global.log_bin")
        if cursor.fetchone()[0] != 1:
            raise ValueError("CDC_BINLOG_DISABLED")
        cursor.execute("CREATE DATABASE ingest_stage")
        cursor.execute(
            "CREATE TABLE ingest_stage.journeys ("
            "_ingest_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,"
            "employer_ref VARCHAR(64) NOT NULL,"
            "status VARCHAR(32) NOT NULL"
            ") ENGINE=InnoDB"
        )
        cursor.execute("SHOW BINARY LOG STATUS")
        file_name, position, *_ = cursor.fetchone()
    return file_name, position


def _mutations(connection):
    # Each successful transaction must produce ROW + XID metadata.
    # ROLLBACK must not create a fourth committed row change.
    with connection.cursor() as cursor:
        cursor.execute(
            "INSERT INTO ingest_stage.journeys (employer_ref,status) VALUES (%s,%s)",
            ("LOCAL_TEST", "STARTED"),
        )
        row_id = cursor.lastrowid
    connection.commit()
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE ingest_stage.journeys SET status=%s WHERE _ingest_id=%s",
            ("COMPLETED", row_id),
        )
    connection.commit()
    with connection.cursor() as cursor:
        cursor.execute(
            "UPDATE ingest_stage.journeys SET status=%s WHERE _ingest_id=%s",
            ("ROLLED_BACK", row_id),
        )
    connection.rollback()
    with connection.cursor() as cursor:
        cursor.execute(
            "DELETE FROM ingest_stage.journeys WHERE _ingest_id=%s", (row_id,),
        )
    connection.commit()
    with connection.cursor() as cursor:
        cursor.execute("SELECT COUNT(*) FROM ingest_stage.journeys")
        assert cursor.fetchone()[0] == 0


def main():
    options = _environment()
    # Import after strict local-only gates to prevent accidental connections.
    import pymysql
    from pymysqlreplication import BinLogStreamReader
    from pymysqlreplication.event import XidEvent
    from pymysqlreplication.row_event import (
        WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent,
    )
    connection = None
    stream = None
    with tempfile.TemporaryDirectory(prefix="fixer-local-binlog-") as work:
        try:
            connection = pymysql.connect(
                host=options["host"], port=options["port"],
                user=options["user"], password=options["passwd"],
                charset="utf8mb4", autocommit=False, connect_timeout=5,
                read_timeout=8, write_timeout=5,
            )
            filename, position = _source(connection)
            baseline = NotificationBaseline(
                source_id="disposable_local_source", binlog_file=filename,
                binlog_position=position, captured_at_utc=datetime.now(timezone.utc),
                source_fingerprint=source_contract_fingerprint(),
                approval="YES_NOTIFICATION_BASELINE_NO_HISTORICAL_COPY",
                retention_hours=24,
            )
            store = SqliteNotificationStore(Path(work) / "notifications.sqlite3")
            assert store.bootstrap(baseline) == "BOOTSTRAPPED"
            _mutations(connection)
            stream = BinLogStreamReader(
                connection_settings=options, server_id=98765431,
                log_file=filename, log_pos=position,
                resume_stream=True, blocking=False,
                only_schemas=["ingest_stage"],
                only_tables=["journeys"],
                only_events=[
                    WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent, XidEvent,
                ],
                freeze_schema=True,
            )
            bridge = NotificationTransactionBridge(
                baseline=baseline, store=store, max_rows=16,
            )
            observed = []
            scanned = 0
            for event in stream:
                scanned += 1
                if scanned > 200:
                    raise ValueError("CDC_BINLOG_EVENT_BUDGET_EXCEEDED")
                name = type(event).__name__
                if name == "XidEvent":
                    # XIDs are handled only after a vetted, pending row event.
                    if not bridge.pending:
                        continue
                    committed = accept_parsed_event(
                        bridge, event, binlog_file=filename,
                    )
                    if committed == "PERSISTED":
                        observed.append("COMMITTED")
                elif name in ("WriteRowsEvent", "UpdateRowsEvent", "DeleteRowsEvent"):
                    if event.schema != "ingest_stage" or event.table != "journeys":
                        raise ValueError("CDC_BINLOG_UNEXPECTED_SOURCE")
                    accept_parsed_event(bridge, event, binlog_file=filename)
                    observed.append(name)
                else:
                    raise ValueError("CDC_BINLOG_UNEXPECTED_EVENT")
                if observed.count("COMMITTED") == 3:
                    break
            assert not bridge.pending, "Incomplete binlog transaction"
            assert observed == [
                "WriteRowsEvent", "COMMITTED",
                "UpdateRowsEvent", "COMMITTED",
                "DeleteRowsEvent", "COMMITTED",
            ], "Unexpected row event/transaction sequence"
            checkpoint = store.checkpoint(baseline.source_id)
            generations = store.generations(baseline.source_id)
            assert checkpoint.generation == 3
            assert generations["journeys"] == 3
            assert all(
                count == 0 for feed, count in generations.items()
                if feed != "journeys"
            )
            print("PASS: actual local MySQL 8.4 ROW/FULL INSERT, UPDATE, DELETE and XID boundaries captured.")
            print("PASS: ROLLBACK omitted; checkpoint and journeys generations persisted for three commits.")
            print("NOT TESTED: AWS replication, shared MySQL metadata writer, leader election or browser refresh.")
        finally:
            if stream is not None:
                stream.close()
            if connection is not None:
                connection.close()


if __name__ == "__main__":
    main()
