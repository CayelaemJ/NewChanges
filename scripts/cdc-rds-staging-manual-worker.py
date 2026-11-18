#!/usr/bin/env python3
"""Staging-only MySQL CDC metadata worker (manual; NOT deployed).

Source rows are decoded by mysql-replication but never logged, serialized, or
persisted. Only allowlisted table names, transaction coordinates, counters and
SHA256 digests reach fixer_cdc_meta (on the same RDS MySQL instance).

Exactly one worker per source must hold the dedicated MySQL advisory lock;
the database checkpoint fencing epoch increments on each acquisition.
Baseline is initialized by a separate approved admin procedure; restricted
metadata writer cannot INSERT checkpoint/feed rows.
Do not run on EC2 until operational controls, recovery tests and DDL handling
are approved. This pilot is intentionally disabled by default.
"""
import hashlib
import json
import os
import re
import secrets
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

HOST = "fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com"
REGION = "eu-north-1"
ACCOUNT = "805068224616"
CA = Path(".local/certs/rds-global-bundle.pem")
SOURCE_ID = "fixer_synthetic_mysql"
LOCK_NAME = "fixer_cdc_meta:fixer_synthetic_mysql"
APPROVE = "I_APPROVE_MANUAL_CDC_WORKER"
FEEDS = tuple(sorted({
    "debt_accounts", "employees", "employers", "journeys", "platform_users",
    "policies", "ratings", "referrals", "salary_advances", "workforce_snapshots",
}))
FILE_NAME = re.compile(r"^mysql-bin-changelog\.[0-9]{6}$")
SCHEMA = "ingest_stage"


def aws(*args):
    return subprocess.run(["aws", *args], check=True,
                          capture_output=True, text=True, timeout=20).stdout.rstrip("\r\n")


def password(user):
    return aws("ssm", "get-parameter", "--region", REGION, "--with-decryption",
               "--name", "/fixer/staging/mysql/" + user.replace("_", "-") + "-password",
               "--query", "Parameter.Value", "--output", "text")


def connect(user, pwd):
    import pymysql
    return pymysql.connect(
        host=HOST, port=3306, user=user, password=pwd,
        ssl={"ca": str(CA.resolve()), "check_hostname": True},
        autocommit=False, connect_timeout=10, read_timeout=15,
        write_timeout=15,
    )


def verify_source(reader, writer):
    with reader.cursor() as cur:
        cur.execute("SELECT @@global.log_bin, @@global.binlog_format, @@global.binlog_row_image")
        if cur.fetchone() != (1, "ROW", "FULL"):
            raise RuntimeError("SOURCE_BINLOG_CONFIGURATION_CHANGED")
        cur.execute("SHOW BINARY LOGS")
        filenames = {row[0] for row in cur.fetchall()}
    with writer.cursor() as cur:
        cur.execute("SELECT source_id,binlog_file,binlog_position,generation,fence_epoch "
                    "FROM fixer_cdc_meta.cdc_checkpoint WHERE source_id=%s FOR UPDATE",
                    (SOURCE_ID,))
        row = cur.fetchone()
    writer.rollback()
    if row and (not FILE_NAME.fullmatch(row[1]) or row[1] not in filenames):
        raise RuntimeError("CHECKPOINT_BINLOG_PURGED_OR_INVALID")
    return row


def acquire_lock(writer):
    with writer.cursor() as cur:
        cur.execute("SELECT GET_LOCK(%s, 0)", (LOCK_NAME,))
        if cur.fetchone()[0] != 1:
            raise RuntimeError("CDC_WORKER_ALREADY_RUNNING")
    writer.commit()



def resume(writer, row):
    source, name, pos, generation, old_epoch = row
    if source != SOURCE_ID or int(pos) < 4 or int(generation) < 0:
        raise RuntimeError("CHECKPOINT_INVALID")
    if int(old_epoch) >= (2**64 - 1):
        raise RuntimeError("FENCE_EPOCH_EXHAUSTED")
    try:
        with writer.cursor() as cur:
            assert_lock_owner(cur)
            cur.execute("UPDATE fixer_cdc_meta.cdc_checkpoint "
                        "SET fence_epoch=fence_epoch+1,updated_at_utc=UTC_TIMESTAMP(6) "
                        "WHERE source_id=%s AND fence_epoch=%s",
                        (SOURCE_ID, old_epoch))
            if cur.rowcount != 1:
                raise RuntimeError("FENCE_EPOCH_CONFLICT")
            cur.execute("SELECT feed,generation FROM fixer_cdc_meta.cdc_feed_generation "
                        "WHERE source_id=%s", (SOURCE_ID,))
            feeds = dict(cur.fetchall())
            if set(feeds) != set(FEEDS) or any(int(n) > int(generation) for n in feeds.values()):
                raise RuntimeError("FEED_INVENTORY_INVALID")
        writer.commit()
    except Exception:
        writer.rollback()
        raise
    return name, int(pos), int(generation), int(old_epoch)+1


def assert_lock_owner(cursor):
    """Fail closed if this connection no longer owns the exclusive source lock."""
    cursor.execute("SELECT IS_USED_LOCK(%s), CONNECTION_ID()", (LOCK_NAME,))
    owner, current = cursor.fetchone()
    if owner is None or int(owner) != int(current):
        raise RuntimeError("CDC_SOURCE_LOCK_LOST")


def commit(writer, start, xid_pos, feeds, digest, generation, fence):
    file_name = start
    if not FILE_NAME.fullmatch(file_name) or int(xid_pos) < 4:
        raise RuntimeError("COORDINATE_INVALID")
    if not feeds or set(feeds) - set(FEEDS):
        raise RuntimeError("UNAPPROVED_FEED")
    try:
        with writer.cursor() as cur:
            assert_lock_owner(cur)
            cur.execute("SELECT binlog_file,binlog_position,generation,fence_epoch "
                        "FROM fixer_cdc_meta.cdc_checkpoint WHERE source_id=%s FOR UPDATE",
                        (SOURCE_ID,))
            row = cur.fetchone()
            if not row or int(row[2]) != generation or int(row[3]) != fence:
                raise RuntimeError("STALE_WORKER_OR_GENERATION")
            if (file_name, int(xid_pos)) <= (row[0], int(row[1])):
                raise RuntimeError("BINLOG_POSITION_REGRESSION")
            cur.execute("INSERT INTO fixer_cdc_meta.cdc_commit_digest "
                        "(source_id,binlog_file,binlog_position,digest) VALUES (%s,%s,%s,%s)",
                        (SOURCE_ID,file_name,int(xid_pos),digest))
            for feed in sorted(feeds):
                cur.execute("UPDATE fixer_cdc_meta.cdc_feed_generation "
                            "SET generation=generation+1 WHERE source_id=%s AND feed=%s",
                            (SOURCE_ID,feed))
                if cur.rowcount != 1:
                    raise RuntimeError("FEED_GENERATION_ROW_MISSING")
            cur.execute("UPDATE fixer_cdc_meta.cdc_checkpoint "
                        "SET binlog_file=%s,binlog_position=%s,generation=generation+1,"
                        "updated_at_utc=UTC_TIMESTAMP(6) "
                        "WHERE source_id=%s AND generation=%s AND fence_epoch=%s",
                        (file_name,int(xid_pos),SOURCE_ID,generation,fence))
            if cur.rowcount != 1:
                raise RuntimeError("CHECKPOINT_WRITE_STALE")
        writer.commit()
    except Exception:
        # On an ambiguous COMMIT, do NOT automatically replay; restart will
        # verify the durable checkpoint and source binlog inventory.
        writer.rollback()
        raise



def stream_connection_settings(reader_password):
    """Bound an idle/dead replication socket; heartbeat should arrive first.

    Failure is intentionally fatal for this run. Recovery must restart from
    the durable MySQL checkpoint under a new fencing epoch.
    """
    return {
        "host":HOST, "port":3306,
        "user":"fixer_cdc_reader", "passwd":reader_password,
        "ssl":{"ca":str(CA.resolve()),"check_hostname":True},
        "connect_timeout":10, "read_timeout":35, "write_timeout":15,
    }


def consume_events(events, writer, initial_file, generation, fence, on_commit=None):
    """Consume already-decoded binlog events; do not handle or persist row values.

    Always fail closed when an event source terminates, including with a
    partially accumulated transaction. A real service must explicitly supervise
    stream restarts, never interpret EOF as a healthy completion.
    """
    if not FILE_NAME.fullmatch(initial_file):
        raise RuntimeError("INITIAL_BINLOG_FILE_INVALID")
    pending=[]
    active_file=initial_file
    for event in events:
        kind=type(event).__name__
        if kind=="RotateEvent":
            if pending:
                raise RuntimeError("ROTATION_WITH_PENDING_TRANSACTION")
            next_file=event.next_binlog
            if isinstance(next_file,bytes):
                next_file=next_file.decode("ascii")
            if not isinstance(next_file,str) or not FILE_NAME.fullmatch(next_file):
                raise RuntimeError("BINLOG_ROTATION_INVALID")
            if next_file < active_file:
                raise RuntimeError("BINLOG_ROTATION_REGRESSION")
            active_file=next_file
            continue
        if kind=="QueryEvent":
            # BEGIN is emitted for ordinary row-based transactions. All
            # other SQL query events are suspicious until explicitly audited:
            # DDL and statement-format operations can invalidate frozen
            # table schemas or alter views without row events.
            query=event.query
            if isinstance(query,bytes):
                query=query.decode("utf8",errors="replace")
            if not isinstance(query,str) or query.strip().upper()!="BEGIN":
                raise RuntimeError("BINLOG_QUERY_EVENT_REQUIRES_SCHEMA_REVIEW")
            continue
        if kind in {"WriteRowsEvent","UpdateRowsEvent","DeleteRowsEvent"}:
            if event.schema!=SCHEMA or event.table not in FEEDS:
                raise RuntimeError("UNEXPECTED_SOURCE")
            # Never read or serialize event.rows values (personal information).
            pending.append((kind,event.table,active_file,event.packet.log_pos))
            if len(pending)>1000:
                raise RuntimeError("TRANSACTION_EVENT_BUDGET_EXCEEDED")
            continue
        if kind=="XidEvent" and pending:
            if any(item[2]!=active_file for item in pending):
                raise RuntimeError("CROSS_FILE_TRANSACTION_REJECTED")
            xid_pos=event.packet.log_pos
            digest=hashlib.sha256(json.dumps({
                "source":SOURCE_ID,"file":active_file,"xid_pos":xid_pos,
                "events":pending,
            },sort_keys=True,separators=(",",":")).encode()).hexdigest()
            impacted={item[1] for item in pending}
            commit(writer,active_file,xid_pos,impacted,digest,generation,fence)
            generation+=1
            if on_commit is not None:
                on_commit(generation,impacted)
            pending=[]
    if pending:
        raise RuntimeError("REPLICATION_STREAM_ENDED_WITH_PENDING_TRANSACTION")
    raise RuntimeError("REPLICATION_STREAM_ENDED")


def run():
    if os.environ.get("FIXER_CDC_WORKER_ACTIVATE") != APPROVE:
        raise RuntimeError("WORKER_MANUALLY_DISABLED")
    if os.environ.get("AWS_DEFAULT_REGION") != REGION or not CA.is_file():
        raise RuntimeError("REGION_OR_TLS_CA_INVALID")
    identity=json.loads(aws("sts","get-caller-identity","--output","json"))
    if identity.get("Account") != ACCOUNT:
        raise RuntimeError("ACCOUNT_MISMATCH")
    rds=json.loads(aws("rds","describe-db-instances","--region",REGION,
        "--db-instance-identifier","fixer-synthetic-mysql","--query","DBInstances[0]",
        "--output","json"))
    if rds.get("Engine")!="mysql" or rds.get("Endpoint",{}).get("Address")!=HOST:
        raise RuntimeError("RDS_IDENTITY_MISMATCH")
    from pymysqlreplication import BinLogStreamReader
    from pymysqlreplication.row_event import WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent
    from pymysqlreplication.event import XidEvent, RotateEvent, QueryEvent

    reader_pwd=password("fixer_cdc_reader")
    writer_pwd=password("fixer_cdc_writer")
    writer=reader=None
    stream=None
    try:
        reader=connect("fixer_cdc_reader",reader_pwd)
        writer=connect("fixer_cdc_writer",writer_pwd)
        acquire_lock(writer)
        row=verify_source(reader,writer)
        if row is None:
            raise RuntimeError("BASELINE_MISSING_RUN_SEPARATE_APPROVED_BOOTSTRAP")
        file_name,pos,generation,fence=resume(writer,row)
        print("WORKER_LOCKED source=",SOURCE_ID,"epoch=",fence,"generation=",generation,
              "binlog=",file_name, "position=",pos, flush=True)
        stream=BinLogStreamReader(
            connection_settings=stream_connection_settings(reader_pwd),
            server_id=secrets.randbelow(600_000_000)+1_300_000_000,
            log_file=file_name,log_pos=pos,resume_stream=True,blocking=True,
            slave_heartbeat=10,
            only_schemas=[SCHEMA],only_tables=list(FEEDS),
            only_events=[WriteRowsEvent,UpdateRowsEvent,DeleteRowsEvent,
                         XidEvent,RotateEvent,QueryEvent],
            freeze_schema=True,
        )
        consume_events(stream, writer, file_name, generation, fence,
                       on_commit=lambda gen, feeds: print(
                           "COMMITTED generation=", gen, "feeds=",
                           ",".join(sorted(feeds)), flush=True))
    finally:
        if stream:
            try:stream.close()
            except Exception:pass
        if reader:
            try:reader.close()
            except Exception:pass
        if writer:
            try:
                with writer.cursor() as cur:
                    cur.execute("SELECT RELEASE_LOCK(%s)",(LOCK_NAME,))
                writer.commit()
            except Exception:pass
            try:writer.close()
            except Exception:pass


if __name__=="__main__":
    try:run()
    except Exception as exc:
        safe=str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__
        print("CDC_WORKER_STOPPED:",safe,file=sys.stderr)
        sys.exit(1)
