#!/usr/bin/env python3
"""Local-only real replication socket interruption regression for The Fixer.

Requires FIXER_CDC_DOCKER_DISCONNECT_TEST=I_APPROVE_LOCAL_DOCKER_ONLY.
Creates one disposable MySQL Docker server bound to loopback, consumes a real
committed row using the worker event loop, then kills that server. Confirms the
replication loop terminates (rather than silently appearing healthy).
No AWS, RDS, Railway, metadata checkpoints, or persistent source data.
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
    "fixer_cdc_disconnect_worker",HERE/"cdc-rds-staging-manual-worker.py")
worker=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def docker(*args,timeout=35):
    p=subprocess.run(["docker",*args],text=True,capture_output=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError("LOCAL_DOCKER_COMMAND_FAILED")
    return p.stdout.strip()


def main():
    if os.getenv("FIXER_CDC_DOCKER_DISCONNECT_TEST")!="I_APPROVE_LOCAL_DOCKER_ONLY":
        raise RuntimeError("LOCAL_DOCKER_TEST_APPROVAL_REQUIRED")
    import pymysql
    from pymysqlreplication import BinLogStreamReader
    from pymysqlreplication.row_event import WriteRowsEvent,UpdateRowsEvent,DeleteRowsEvent
    from pymysqlreplication.event import XidEvent,RotateEvent,QueryEvent

    name="fixer-cdc-disconnect-"+secrets.token_hex(8)
    password="local-"+secrets.token_hex(20)
    db=None
    stream=None
    created=False
    thread=None
    first_commit=threading.Event()
    completed=threading.Event()
    results={"commits":0,"failure":None}
    try:
        docker("run","-d","--rm","--name",name,
               "-e","MYSQL_ROOT_PASSWORD="+password,
               "-p","127.0.0.1::3306",
               "mysql:8.4","--server-id=91729988",
               "--log-bin=mysql-bin-changelog",
               "--binlog-format=ROW","--binlog-row-image=FULL")
        created=True
        port=int(docker("port",name,"3306/tcp").rsplit(":",1)[-1])
        for _ in range(90):
            try:
                db=pymysql.connect(host="127.0.0.1",port=port,
                                   user="root",password=password,
                                   autocommit=True,connect_timeout=2)
                break
            except pymysql.MySQLError:
                time.sleep(1)
        if db is None:
            raise RuntimeError("LOCAL_MYSQL_NOT_READY")
        with db.cursor() as cur:
            cur.execute("CREATE DATABASE ingest_stage")
            cur.execute("CREATE TABLE ingest_stage.journeys "
                        "(id INT PRIMARY KEY, status VARCHAR(20)) ENGINE=InnoDB")
            cur.execute("SHOW BINARY LOG STATUS")
            start_file,start_pos,*_=cur.fetchone()
        if not worker.FILE_NAME.fullmatch(start_file):
            raise RuntimeError("LOCAL_BINLOG_FILENAME_UNEXPECTED")
        settings={
            "host":"127.0.0.1","port":port,"user":"root","passwd":password,
            "connect_timeout":5,"read_timeout":5,"write_timeout":5,
        }
        stream=BinLogStreamReader(
            connection_settings=settings,server_id=91729989,
            log_file=start_file,log_pos=start_pos,
            resume_stream=True,blocking=True,slave_heartbeat=1,
            only_schemas=["ingest_stage"],only_tables=["journeys"],
            only_events=[WriteRowsEvent,UpdateRowsEvent,DeleteRowsEvent,
                         XidEvent,RotateEvent,QueryEvent],
            freeze_schema=True)

        def recorded_commit(*args):
            results["commits"]+=1
            first_commit.set()

        def run_worker():
            try:
                with patch.object(worker,"commit",side_effect=recorded_commit):
                    worker.consume_events(stream,object(),start_file,0,7)
                results["failure"]="UNEXPECTED_NORMAL_EXIT"
            except Exception as error:
                # Store class and a safe error category only; no data values.
                results["failure"]=type(error).__name__
            finally:
                completed.set()

        thread=threading.Thread(target=run_worker,daemon=True)
        thread.start()
        with db.cursor() as cur:
            cur.execute("INSERT INTO ingest_stage.journeys VALUES (1,'test')")
        if not first_commit.wait(15):
            raise AssertionError("INITIAL_COMMITTED_EVENT_NOT_RECEIVED")
        if results["commits"]!=1:
            raise AssertionError("UNEXPECTED_COMMIT_COUNT_BEFORE_DISCONNECT")
        print("PASS: actual worker event loop consumed committed local MySQL row",flush=True)

        # Simulate a real network/server outage. No data or checkpoint is
        # written to RDS; all server state resides in disposable Docker.
        docker("stop","-t","1",name,timeout=30)
        if not completed.wait(15):
            raise AssertionError("REPLICATION_DID_NOT_STOP_AFTER_SOCKET_DISCONNECT")
        if results["failure"] in (None,"UNEXPECTED_NORMAL_EXIT"):
            raise AssertionError("DISCONNECT_NOT_REPORTED_AS_FAILURE")
        if results["commits"]!=1:
            raise AssertionError("DUPLICATE_COMMIT_AFTER_DISCONNECT")
        print("PASS: replication socket loss terminated worker event loop",flush=True)
        print("PASS: no duplicate committed notifications after disconnect",flush=True)
        print("DISCONNECT_EXCEPTION_TYPE:",results["failure"],flush=True)
        print("NO AWS/RDS ACCESS. NO CHECKPOINT. NO EC2 SERVICE ACTIVATION.",flush=True)
    finally:
        if stream is not None:
            try:stream.close()
            except Exception:pass
        if db is not None:
            try:db.close()
            except Exception:pass
        if created:
            p=subprocess.run(["docker","rm","-f",name],text=True,
                             capture_output=True,timeout=30)
            # --rm removes the container on stop; "No such container" is OK.
            if p.returncode!=0 and "No such container" not in p.stderr:
                print("CLEANUP_WARNING: inspect disposable local container",file=sys.stderr)
            else:
                print("CLEANUP: disposable local disconnect container removed.",flush=True)


if __name__=="__main__":
    try:
        main()
    except Exception as error:
        safe=str(error) if isinstance(error,(RuntimeError,AssertionError)) else type(error).__name__
        print("CDC_LOCAL_DISCONNECT_FAILED:",safe,file=sys.stderr)
        sys.exit(1)
