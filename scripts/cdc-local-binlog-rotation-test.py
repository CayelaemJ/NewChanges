#!/usr/bin/env python3
"""Test real MySQL binlog rotation safely in disposable loopback-only Docker.

Does not read or write AWS, RDS, Railway, or persistent local databases.
Requires FIXER_CDC_DOCKER_ROTATION_TEST=I_APPROVE_LOCAL_DOCKER_ONLY.
"""
import os
import secrets
import subprocess
import sys
import time


def docker(*args, timeout=35):
    result=subprocess.run(["docker",*args],text=True,capture_output=True,
                          timeout=timeout)
    if result.returncode:
        raise RuntimeError("LOCAL_DOCKER_COMMAND_FAILED")
    return result.stdout.strip()


def main():
    if os.environ.get("FIXER_CDC_DOCKER_ROTATION_TEST") != "I_APPROVE_LOCAL_DOCKER_ONLY":
        raise RuntimeError("LOCAL_DOCKER_APPROVAL_REQUIRED")
    import pymysql
    from pymysqlreplication import BinLogStreamReader
    from pymysqlreplication.row_event import WriteRowsEvent
    from pymysqlreplication.event import RotateEvent, XidEvent

    name="fixer-cdc-binlog-rotation-"+secrets.token_hex(8)
    password="local-"+secrets.token_hex(20)
    db=None
    stream=None
    created=False
    try:
        docker("run","-d","--rm","--name",name,
            "-e","MYSQL_ROOT_PASSWORD="+password,
            "-p","127.0.0.1::3306",
            "mysql:8.4",
            "--server-id=91729992","--log-bin=mysql-bin",
            "--binlog-format=ROW","--binlog-row-image=FULL")
        created=True
        port=int(docker("port",name,"3306/tcp").rsplit(":",1)[-1])
        for _ in range(90):
            try:
                db=pymysql.connect(host="127.0.0.1",port=port,user="root",
                                  password=password,autocommit=True,
                                  connect_timeout=2)
                break
            except pymysql.MySQLError:
                time.sleep(1)
        if db is None:
            raise RuntimeError("LOCAL_MYSQL_NOT_READY")
        with db.cursor() as cursor:
            cursor.execute("CREATE DATABASE cdc_rotation_test")
            cursor.execute("CREATE TABLE cdc_rotation_test.probe "
                           "(id INT PRIMARY KEY, name VARCHAR(25)) ENGINE=InnoDB")
            cursor.execute("SHOW BINARY LOG STATUS")
            start_file,start_pos,*_=cursor.fetchone()
            cursor.execute("INSERT INTO cdc_rotation_test.probe VALUES (1,'before')")
            cursor.execute("FLUSH BINARY LOGS")  # Local disposable server only.
            cursor.execute("INSERT INTO cdc_rotation_test.probe VALUES (2,'after')")
            cursor.execute("SHOW BINARY LOG STATUS")
            end_file,end_pos,*_=cursor.fetchone()
        if start_file==end_file:
            raise AssertionError("LOCAL_BINLOG_DID_NOT_ROTATE")
        print("PASS: disposable local server rotated binary log",flush=True)

        stream=BinLogStreamReader(
            connection_settings={"host":"127.0.0.1","port":port,
                                 "user":"root","passwd":password},
            server_id=91729993,log_file=start_file,log_pos=start_pos,
            resume_stream=True,blocking=False,
            only_schemas=["cdc_rotation_test"],only_tables=["probe"],
            only_events=[WriteRowsEvent,RotateEvent,XidEvent],
            freeze_schema=True,
        )
        committed_files=[]
        pending_rows=0
        active_file=start_file
        rotate_seen=False
        for i,event in enumerate(stream):
            if i>250:
                raise AssertionError("UNEXPECTED_EVENT_VOLUME")
            if isinstance(event,RotateEvent):
                target=event.next_binlog
                if isinstance(target,bytes):
                    target=target.decode("ascii")
                if target==end_file:
                    rotate_seen=True
                if pending_rows:
                    raise AssertionError("ROTATION_DURING_PENDING_ROW_TRANSACTION")
                active_file=target
            elif isinstance(event,WriteRowsEvent):
                if event.schema!="cdc_rotation_test" or event.table!="probe":
                    raise AssertionError("UNEXPECTED_ROW_SOURCE")
                # Count row events without relying on library-specific decoded
                # column names (UNKNOWN_COL* is valid without FULL metadata).
                pending_rows+=len(event.rows)
            elif isinstance(event,XidEvent) and pending_rows:
                if pending_rows!=1:
                    raise AssertionError("UNEXPECTED_COMMITTED_ROW_COUNT")
                committed_files.append(active_file)
                pending_rows=0
        if not rotate_seen:
            raise AssertionError("ROTATION_EVENT_NOT_OBSERVED")
        if committed_files!=[start_file,end_file]:
            raise AssertionError(
                "CROSS_ROTATION_COMMIT_INCOMPLETE: "
                + repr(committed_files)
            )
        print("PASS: replication reader observed binlog RotateEvent",flush=True)
        print("PASS: both committed local transactions seen across rotation",flush=True)
        print("NO RDS WRITES. NO CDC BASELINE. NO EC2 WORKER ENABLED.",flush=True)
    finally:
        if stream:
            try:stream.close()
            except Exception:pass
        if db:
            try:db.close()
            except Exception:pass
        if created:
            result=subprocess.run(["docker","rm","-f",name],
                                  capture_output=True,text=True,timeout=30)
            if result.returncode:
                print("CLEANUP_WARNING: inspect local container "+name,file=sys.stderr)
            else:
                print("CLEANUP: local rotation test container removed.",flush=True)


if __name__=="__main__":
    try:main()
    except Exception as exc:
        safe=str(exc) if isinstance(exc,(RuntimeError,AssertionError)) else type(exc).__name__
        print("CDC_LOCAL_ROTATION_FAILED:",safe,file=sys.stderr)
        sys.exit(1)
