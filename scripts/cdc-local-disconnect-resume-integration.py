#!/usr/bin/env python3
"""Real local MySQL CDC stream + metadata restart/replay integration test.

Disposable loopback-only mysql:8.4 Docker container. No AWS/RDS/Railway access.
Requires FIXER_CDC_DOCKER_RESTART_TEST=I_APPROVE_LOCAL_DOCKER_ONLY.
Exercises actual worker acquire_lock/resume/commit/consume_events against
durable MySQL checkpoint metadata, including data committed while disconnected.
"""
import importlib.util
import os
import secrets
import subprocess
import sys
import threading
import time
from pathlib import Path
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location(
    "fixer_cdc_restart_worker",HERE/"cdc-rds-staging-manual-worker.py")
worker=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)

def docker(*args,timeout=35):
    result=subprocess.run(["docker",*args],text=True,capture_output=True,timeout=timeout)
    if result.returncode:
        raise RuntimeError("LOCAL_DOCKER_COMMAND_FAILED")
    return result.stdout.strip()

def query(db,sql,args=()):
    with db.cursor() as cur:
        cur.execute(sql,args)
        return cur.fetchall()

def state(db):
    # The admin connection uses autocommit=False (MySQL REPEATABLE READ).
    # End any older read snapshot before inspecting a worker commit; otherwise
    # this test can falsely report a stale checkpoint after a successful replay.
    db.commit()
    rows=query(db,"SELECT binlog_file,binlog_position,generation,fence_epoch "
        "FROM fixer_cdc_meta.cdc_checkpoint WHERE source_id=%s",(worker.SOURCE_ID,))
    if len(rows)!=1:raise AssertionError("CHECKPOINT_CARDINALITY_INVALID")
    return rows[0]

def main():
    if os.getenv("FIXER_CDC_DOCKER_RESTART_TEST")!="I_APPROVE_LOCAL_DOCKER_ONLY":
        raise RuntimeError("LOCAL_DOCKER_APPROVAL_REQUIRED")
    import pymysql
    from pymysqlreplication import BinLogStreamReader
    from pymysqlreplication.row_event import WriteRowsEvent,UpdateRowsEvent,DeleteRowsEvent
    from pymysqlreplication.event import QueryEvent,XidEvent,RotateEvent

    name="fixer-cdc-restart-"+secrets.token_hex(8)
    password="local-"+secrets.token_hex(20)
    created=False
    admin=None
    writer=None
    stream=None
    try:
        docker("run","-d","--rm","--name",name,
            "-e","MYSQL_ROOT_PASSWORD="+password,
            "-p","127.0.0.1::3306",
            "mysql:8.4","--server-id=91729984",
            "--log-bin=mysql-bin-changelog",
            "--binlog-format=ROW","--binlog-row-image=FULL")
        created=True
        port=int(docker("port",name,"3306/tcp").rsplit(":",1)[-1])
        def connect():
            return pymysql.connect(host="127.0.0.1",port=port,user="root",
                password=password,autocommit=False,connect_timeout=3,
                read_timeout=12,write_timeout=12)
        for _ in range(90):
            try:
                admin=connect()
                break
            except pymysql.MySQLError:time.sleep(1)
        if admin is None:raise RuntimeError("LOCAL_MYSQL_NOT_READY")
        for ddl in [
            "CREATE DATABASE ingest_stage",
            "CREATE TABLE ingest_stage.journeys "
                "(id INT PRIMARY KEY, status VARCHAR(30)) ENGINE=InnoDB",
            "CREATE DATABASE fixer_cdc_meta",
            "CREATE TABLE fixer_cdc_meta.cdc_checkpoint ("
                "source_id VARCHAR(100) PRIMARY KEY,"
                "binlog_file VARCHAR(128) NOT NULL,"
                "binlog_position BIGINT UNSIGNED NOT NULL,"
                "generation BIGINT UNSIGNED NOT NULL,"
                "fence_epoch BIGINT UNSIGNED NOT NULL,"
                "updated_at_utc DATETIME(6) NOT NULL) ENGINE=InnoDB",
            "CREATE TABLE fixer_cdc_meta.cdc_feed_generation ("
                "source_id VARCHAR(100) NOT NULL,feed VARCHAR(64) NOT NULL,"
                "generation BIGINT UNSIGNED NOT NULL,"
                "PRIMARY KEY(source_id,feed),"
                "FOREIGN KEY(source_id) REFERENCES fixer_cdc_meta.cdc_checkpoint(source_id)) ENGINE=InnoDB",
            "CREATE TABLE fixer_cdc_meta.cdc_commit_digest ("
                "source_id VARCHAR(100) NOT NULL,"
                "binlog_file VARCHAR(128) NOT NULL,"
                "binlog_position BIGINT UNSIGNED NOT NULL,"
                "digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,"
                "PRIMARY KEY(source_id,binlog_file,binlog_position),"
                "FOREIGN KEY(source_id) REFERENCES fixer_cdc_meta.cdc_checkpoint(source_id)) ENGINE=InnoDB",
        ]:query(admin,ddl)
        admin.commit()
        baseline=query(admin,"SHOW BINARY LOG STATUS")[0]
        start_file,start_pos=baseline[0],int(baseline[1])
        if not worker.FILE_NAME.fullmatch(start_file):
            raise AssertionError("INVALID_LOCAL_RDS_LIKE_BINLOG_FILENAME")
        query(admin,"INSERT INTO fixer_cdc_meta.cdc_checkpoint "
            "VALUES (%s,%s,%s,0,1,UTC_TIMESTAMP(6))",
            (worker.SOURCE_ID,start_file,start_pos))
        with admin.cursor() as cur:
            cur.executemany("INSERT INTO fixer_cdc_meta.cdc_feed_generation "
                "VALUES (%s,%s,0)",[(worker.SOURCE_ID,feed) for feed in worker.FEEDS])
        admin.commit()
        print("PASS: disposable MySQL durable checkpoint and source baseline created",flush=True)

        def make_stream(file,pos,server_id):
            return BinLogStreamReader(
                connection_settings={"host":"127.0.0.1","port":port,
                    "user":"root","passwd":password,
                    "connect_timeout":5,"read_timeout":5,"write_timeout":5},
                server_id=server_id,log_file=file,log_pos=pos,
                resume_stream=True,blocking=True,slave_heartbeat=1,
                only_schemas=[worker.SCHEMA],only_tables=list(worker.FEEDS),
                only_events=[WriteRowsEvent,UpdateRowsEvent,DeleteRowsEvent,
                             XidEvent,RotateEvent,QueryEvent],
                freeze_schema=True)

        writer=connect()
        worker.acquire_lock(writer)
        initial=query(writer,"SELECT source_id,binlog_file,binlog_position,generation,fence_epoch "
            "FROM fixer_cdc_meta.cdc_checkpoint WHERE source_id=%s",(worker.SOURCE_ID,))[0]
        file,pos,gen,fence=worker.resume(writer,initial)
        stream=make_stream(file,pos,91729985)
        committed=threading.Event()
        outcome={}
        def on_first(g,feeds):
            if g==1 and feeds=={"journeys"}:committed.set()
        def first_consumer():
            try:
                worker.consume_events(stream,writer,file,gen,fence,on_commit=on_first)
            except Exception as error:
                outcome["first"]=type(error).__name__
        first_thread=threading.Thread(target=first_consumer,daemon=True)
        first_thread.start()
        query(admin,"INSERT INTO ingest_stage.journeys VALUES (1,'before')")
        admin.commit()
        if not committed.wait(20):
            raise AssertionError("FIRST_TRANSACTION_NOT_CHECKPOINTED")
        if int(state(admin)[2])!=1:
            raise AssertionError("FIRST_CHECKPOINT_INCORRECT")
        # Force a replica-reader connection loss without stopping MySQL.
        # close() from this thread is a deterministic socket interruption.
        stream.close()
        first_thread.join(timeout=10)
        if first_thread.is_alive():
            raise AssertionError("FIRST_STREAM_DID_NOT_STOP")
        stream=None
        if int(state(admin)[2])!=1:
            raise AssertionError("CHECKPOINT_CHANGED_AFTER_READER_DISCONNECT")
        print("PASS: first real row transaction committed atomically; reader interrupted",flush=True)

        # Data changes while the worker is not connected.
        query(admin,"INSERT INTO ingest_stage.journeys VALUES (2,'during_outage')")
        admin.commit()
        previous=state(admin)
        if int(previous[2])!=1:
            raise AssertionError("OUTAGE_ADVANCED_CHECKPOINT_UNEXPECTEDLY")
        worker_state=query(writer,"SELECT source_id,binlog_file,binlog_position,generation,fence_epoch "
            "FROM fixer_cdc_meta.cdc_checkpoint WHERE source_id=%s",(worker.SOURCE_ID,))[0]
        file,pos,gen,fence=worker.resume(writer,worker_state)
        if (gen,fence)!=(1,3):
            raise AssertionError("RESUME_FENCE_INVALID")
        second_committed=threading.Event()
        stream=make_stream(file,pos,91729986)
        def on_second(g,feeds):
            if g==2 and feeds=={"journeys"}:second_committed.set()
        def second_consumer():
            try:
                worker.consume_events(stream,writer,file,gen,fence,on_commit=on_second)
            except Exception as error:
                outcome["second"]=type(error).__name__
        second_thread=threading.Thread(target=second_consumer,daemon=True)
        second_thread.start()
        if not second_committed.wait(20):
            raise AssertionError("MISSED_OUTAGE_COMMIT_NOT_REPLAYED")
        stream.close()
        second_thread.join(timeout=10)
        if second_thread.is_alive():
            raise AssertionError("SECOND_STREAM_DID_NOT_STOP")
        stream=None
        after=state(admin)
        if int(after[2])!=2 or int(after[3])!=3:
            raise AssertionError("RESTART_DURABLE_CHECKPOINT_INCORRECT:"
                "generation="+str(after[2])+",fence="+str(after[3]))
        feed_generation=query(admin,"SELECT generation FROM fixer_cdc_meta.cdc_feed_generation "
            "WHERE source_id=%s AND feed='journeys'",(worker.SOURCE_ID,))[0][0]
        digests=query(admin,"SELECT COUNT(*) FROM fixer_cdc_meta.cdc_commit_digest")[0][0]
        if (int(feed_generation),int(digests))!=(2,2):
            raise AssertionError("REPLAY_DUPLICATED_OR_LOST_GENERATION")
        print("PASS: outage transaction caught up from durable checkpoint",flush=True)
        print("PASS: exactly two committed digests and feed-generation increments",flush=True)
        print("PASS: restart advanced fencing epoch and recovered without duplicate",flush=True)
        print("NO AWS/RDS/RAILWAY ACCESS. NO REAL CDC BASELINE. NO EC2 ACTIVATION.",flush=True)
    finally:
        if stream is not None:
            try:stream.close()
            except Exception:pass
        if writer is not None:
            try:writer.close()
            except Exception:pass
        if admin is not None:
            try:admin.close()
            except Exception:pass
        if created:
            p=subprocess.run(["docker","rm","-f",name],capture_output=True,
                text=True,timeout=30)
            if p.returncode:
                print("CLEANUP_WARNING: inspect local container "+name,file=sys.stderr)
            else:
                print("CLEANUP: disposable local restart container removed.",flush=True)

if __name__=="__main__":
    try:main()
    except Exception as error:
        safe=str(error) if isinstance(error,(RuntimeError,AssertionError)) else type(error).__name__
        print("CDC_LOCAL_RESTART_FAILED:",safe,file=sys.stderr)
        sys.exit(1)
