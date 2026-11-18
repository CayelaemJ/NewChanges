#!/usr/bin/env python3
"""Read-only, bounded, real AWS MySQL replication handshake probe.

Reads only metadata from the current binlog window. Does not extract, print,
log or persist row values; does not initialize a checkpoint, create source
changes, or enable any service. Executes only against the approved synthetic
RDS host, and requires a live SSM reader credential.
"""
import os
import re
import subprocess
import sys
import secrets
from pathlib import Path

HOST = "fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com"
CA = Path(".local/certs/rds-global-bundle.pem")
NAME = "/fixer/staging/mysql/fixer-cdc-reader-password"
TABLES = frozenset({
    "employers", "workforce_snapshots", "employees", "platform_users",
    "journeys", "debt_accounts", "policies", "ratings", "referrals",
    "salary_advances",
})
FILE_PATTERN = re.compile(r"^mysql-bin-changelog\.[0-9]{6}$")


def aws(*args):
    proc = subprocess.run(
        ["aws", *args], check=True, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, timeout=20,
    )
    return proc.stdout.rstrip("\r\n")


def main():
    if os.environ.get("AWS_DEFAULT_REGION") != "eu-north-1":
        raise RuntimeError("REGION_MISMATCH")
    import json
    identity = json.loads(aws("sts", "get-caller-identity", "--output", "json"))
    if identity.get("Account") != "805068224616":
        raise RuntimeError("AWS_ACCOUNT_MISMATCH")
    if not CA.is_file():
        raise RuntimeError("RDS_CA_BUNDLE_MISSING")
    import pymysql
    from pymysqlreplication import BinLogStreamReader
    from pymysqlreplication.row_event import (
        WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent,
    )
    from pymysqlreplication.event import XidEvent, RotateEvent

    password = aws(
        "ssm", "get-parameter", "--region", "eu-north-1", "--name", NAME,
        "--with-decryption", "--query", "Parameter.Value", "--output", "text",
    )
    ssl = {"ca": str(CA.resolve()), "check_hostname": True}
    options = {
        "host": HOST, "port": 3306, "user": "fixer_cdc_reader",
        "passwd": password, "ssl": ssl,
        "connect_timeout": 10, "read_timeout": 10,
    }
    conn = None
    stream = None
    try:
        conn = pymysql.connect(**options)
        with conn.cursor() as cur:
            cur.execute("SELECT @@global.log_bin, @@global.binlog_format, @@global.binlog_row_image")
            if cur.fetchone() != (1, "ROW", "FULL"):
                raise RuntimeError("BINLOG_MODE_MISMATCH")
            cur.execute("SHOW BINARY LOG STATUS")
            filename, position, *_ = cur.fetchone()
            cur.execute("SHOW BINARY LOGS")
            inventory = {row[0] for row in cur.fetchall()}
            if not FILE_PATTERN.fullmatch(filename) or filename not in inventory:
                raise RuntimeError("INVALID_SOURCE_BINLOG")
        # Start at offset 4 of the current file; no historic data import and no
        # persistent checkpoint. Server may return 0 approved events.
        print("PASS: CDC reader SQL/TLS authenticated, ROW/FULL verified")
        print("WINDOW:", filename, "from_position=4", "observed_end=", position)
        print("TEST_MODE: bounded, read-only replication, no row values printed")
        stream = BinLogStreamReader(
            connection_settings=options,
            server_id=secrets.randbelow(750_000_000) + 1_200_000_000,
            log_file=filename, log_pos=4,
            resume_stream=True, blocking=False,
            only_schemas=["ingest_stage"],
            only_tables=sorted(TABLES),
            only_events=[
                WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent,
                XidEvent, RotateEvent,
            ],
            freeze_schema=True,
        )
        observed = 0
        counts = {
            "WriteRowsEvent": 0, "UpdateRowsEvent": 0,
            "DeleteRowsEvent": 0, "XidEvent": 0,
            "RotateEvent": 0,
        }
        for event in stream:
            observed += 1
            if observed > 100:
                raise RuntimeError("EVENT_LIMIT_EXCEEDED")
            typ = type(event).__name__
            if typ not in counts:
                raise RuntimeError("UNEXPECTED_EVENT_TYPE")
            # Do not access .rows / source values.
            counts[typ] += 1
            if typ in ("WriteRowsEvent", "UpdateRowsEvent", "DeleteRowsEvent"):
                if event.schema != "ingest_stage" or event.table not in TABLES:
                    raise RuntimeError("SOURCE_ALLOWLIST_MISMATCH")
        print("PASS: MySQL replication protocol returned cleanly")
        print("EVENT_COUNTS:", counts)
        if observed == 0:
            print("NOTE: no matching events in current file; event parsing not proven yet.")
        else:
            print("NOTE: events observed; transactional handling not yet proven.")
        print("NO CHECKPOINT SAVED. NO WORKER ENABLED.")
    finally:
        if stream is not None:
            stream.close()
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Do not print library errors; may include connection or credential data.
        print("CDC_STREAM_PROBE_FAILED:", type(exc).__name__,
              getattr(exc, "args", ["UNKNOWN"])[0]
              if type(exc).__name__ == "RuntimeError" else
              getattr(exc, "args", ["UNKNOWN"])[0]
              if getattr(exc, "args", None) and isinstance(exc.args[0], int) else
              "CHECK_SOURCE_AND_TLS", file=sys.stderr)
        sys.exit(1)
