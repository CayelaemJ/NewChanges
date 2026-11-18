#!/usr/bin/env python3
"""Explicit synthetic-only RDS ROW/FULL replication integration test.

Creates and drops ONE random, isolated schema fixer_cdc_probe_<hex>.
Never touches ingest_stage, fixer_cdc_meta, PostgreSQL or Railway.
Three committed transactions: INSERT, UPDATE, DELETE. One rolled-back
UPDATE must be absent. No row values are printed or persisted by the probe.
Does not create a production checkpoint or activate the worker.
"""
import json
import os
import secrets
import subprocess
import sys
from pathlib import Path

HOST = "fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com"
REGION = "eu-north-1"
ACCOUNT = "805068224616"
CA = Path(".local/certs/rds-global-bundle.pem")
APPROVAL = "I_APPROVE_ISOLATED_RDS_CDC_TEST"
TABLE = "cdc_probe_events"


def aws(*args):
    return subprocess.run(
        ["aws", *args], check=True, capture_output=True, text=True, timeout=25
    ).stdout.rstrip("\r\n")


def connect(user, password):
    import pymysql
    return pymysql.connect(
        host=HOST, port=3306, user=user, password=password,
        ssl={"ca": str(CA.resolve()), "check_hostname": True},
        connect_timeout=10, read_timeout=15, write_timeout=15,
        autocommit=False,
    )


def main():
    if os.getenv("FIXER_CDC_RDS_ROW_TEST") != APPROVAL:
        raise RuntimeError("EXPLICIT_ISOLATED_TEST_APPROVAL_REQUIRED")
    if os.getenv("AWS_DEFAULT_REGION") != REGION or not CA.is_file():
        raise RuntimeError("REGION_OR_CA_MISMATCH")
    ident = json.loads(aws("sts", "get-caller-identity", "--output", "json"))
    if ident.get("Account") != ACCOUNT:
        raise RuntimeError("ACCOUNT_MISMATCH")
    rds = json.loads(aws(
        "rds", "describe-db-instances", "--region", REGION,
        "--db-instance-identifier", "fixer-synthetic-mysql",
        "--query", "DBInstances[0]", "--output", "json",
    ))
    if (rds.get("Engine") != "mysql" or
            rds.get("DBInstanceStatus") != "available" or
            rds.get("Endpoint", {}).get("Address") != HOST):
        raise RuntimeError("RDS_INSTANCE_MISMATCH")

    from pymysqlreplication import BinLogStreamReader
    from pymysqlreplication.row_event import (
        WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent,
    )
    from pymysqlreplication.event import XidEvent, RotateEvent

    admin_pw = aws(
        "ssm", "get-parameter", "--region", REGION,
        "--name", "/fixer/staging/mysql/admin-password",
        "--with-decryption", "--query", "Parameter.Value", "--output", "text"
    )
    reader_pw = aws(
        "ssm", "get-parameter", "--region", REGION,
        "--name", "/fixer/staging/mysql/fixer-cdc-reader-password",
        "--with-decryption", "--query", "Parameter.Value", "--output", "text"
    )

    schema = "fixer_cdc_probe_" + secrets.token_hex(8)
    admin = None
    stream = None
    created = False
    try:
        admin = connect("fixeradmin", admin_pw)
        with admin.cursor() as cur:
            cur.execute("SELECT @@global.log_bin, @@global.binlog_format, @@global.binlog_row_image")
            if cur.fetchone() != (1, "ROW", "FULL"):
                raise RuntimeError("BINLOG_FORMAT_MISMATCH")
            cur.execute("CREATE DATABASE `" + schema + "`")
            created = True
            cur.execute(
                "CREATE TABLE `" + schema + "`.`" + TABLE + "` "
                "(id BIGINT NOT NULL PRIMARY KEY, status VARCHAR(32) NOT NULL) "
                "ENGINE=InnoDB"
            )
            cur.execute("SHOW BINARY LOG STATUS")
            filename, position, *_ = cur.fetchone()

            cur.execute(
                "INSERT INTO `" + schema + "`.`" + TABLE +
                "` (id,status) VALUES (%s,%s)", (1, "CREATED")
            )
            admin.commit()
            cur.execute(
                "UPDATE `" + schema + "`.`" + TABLE +
                "` SET status=%s WHERE id=%s", ("UPDATED", 1)
            )
            admin.commit()
            cur.execute(
                "UPDATE `" + schema + "`.`" + TABLE +
                "` SET status=%s WHERE id=%s", ("ROLLED_BACK", 1)
            )
            admin.rollback()
            cur.execute(
                "DELETE FROM `" + schema + "`.`" + TABLE +
                "` WHERE id=%s", (1,)
            )
            admin.commit()

        stream = BinLogStreamReader(
            connection_settings={
                "host": HOST, "port": 3306,
                "user": "fixer_cdc_reader", "passwd": reader_pw,
                "ssl": {"ca": str(CA.resolve()), "check_hostname": True},
                "connect_timeout": 10, "read_timeout": 12,
            },
            server_id=secrets.randbelow(600_000_000) + 1_300_000_000,
            log_file=filename, log_pos=position,
            resume_stream=True, blocking=False,
            only_schemas=[schema], only_tables=[TABLE],
            only_events=[
                WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent,
                XidEvent, RotateEvent,
            ],
            freeze_schema=True,
        )
        observed = []
        awaiting_commit = None
        scanned = 0
        for event in stream:
            scanned += 1
            if scanned > 200:
                raise RuntimeError("EVENT_LIMIT_EXCEEDED")
            typ = type(event).__name__
            if typ in ("WriteRowsEvent", "UpdateRowsEvent", "DeleteRowsEvent"):
                if event.schema != schema or event.table != TABLE:
                    raise RuntimeError("UNEXPECTED_SOURCE_TABLE")
                if awaiting_commit is not None:
                    raise RuntimeError("MISSING_TRANSACTION_BOUNDARY")
                # Do not inspect or print raw row values.
                awaiting_commit = typ
            elif typ == "XidEvent" and awaiting_commit is not None:
                observed.append(awaiting_commit)
                awaiting_commit = None
            elif typ == "RotateEvent":
                pass
        expected = ["WriteRowsEvent", "UpdateRowsEvent", "DeleteRowsEvent"]
        if awaiting_commit or observed != expected:
            raise RuntimeError("COMMIT_BOUNDARY_TEST_FAILED")
        print("PASS: live RDS binlog captured committed INSERT, UPDATE, DELETE.")
        print("PASS: rolled-back UPDATE did not produce an extra committed change.")
        print("PASS: all observed row events originated in the isolated test schema.")
        print("NO SOURCE ROW COPIES. NO CDC CHECKPOINT. NO WORKER ENABLED.")
    finally:
        if stream is not None:
            try:
                stream.close()
            except Exception:
                pass
        if admin is not None:
            if created:
                try:
                    with admin.cursor() as cur:
                        cur.execute("DROP DATABASE `" + schema + "`")
                    admin.commit()
                    print("CLEANUP: isolated CDC test schema dropped.")
                except Exception:
                    print("CLEANUP_REQUIRED: isolated test schema could not be dropped.", file=sys.stderr)
            admin.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        # Deliberately avoid printing MySQL exception SQL and credential details.
        safe = str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__
        print("RDS_CDC_ROW_TEST_FAILED:", safe, file=sys.stderr)
        sys.exit(1)
