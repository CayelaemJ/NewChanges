#!/usr/bin/env python3
"""Local Docker-only test of the actual MySQL DDL QueryEvent and worker guard.

No AWS calls, no RDS access, no checkpoints and no EC2 worker activation.
The test intentionally uses the same QueryEvent filtering as the production
worker and confirms a real ALTER TABLE is not silently ignored.
"""
import importlib.util
import os
import re
import secrets
import subprocess
import sys
import time
from pathlib import Path
from unittest.mock import patch


HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location(
    "fixer_cdc_guard",HERE/"cdc-rds-staging-manual-worker.py")
worker=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def docker(*args,timeout=45):
    p=subprocess.run(["docker",*args],text=True,capture_output=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError("LOCAL_DOCKER_COMMAND_FAILED")
    return p.stdout.strip()


def main():
    if os.getenv("FIXER_CDC_DOCKER_DDL_TEST")!="I_APPROVE_LOCAL_DOCKER_ONLY":
        raise RuntimeError("LOCAL_DOCKER_TEST_APPROVAL_REQUIRED")
    import pymysql
    from pymysqlreplication import BinLogStreamReader
    from pymysqlreplication.row_event import WriteRowsEvent,UpdateRowsEvent,DeleteRowsEvent
    from pymysqlreplication.event import QueryEvent,XidEvent,RotateEvent

    name="fixer-cdc-ddl-"+secrets.token_hex(8)
    password="local-"+secrets.token_hex(20)
    created=False
    db=None
    stream=None
    try:
        docker("run","-d","--rm","--name",name,
               "-e","MYSQL_ROOT_PASSWORD="+password,
               "-p","127.0.0.1::3306","mysql:8.4",
               "--server-id=91729998","--log-bin=mysql-bin",
               "--binlog-format=ROW","--binlog-row-image=FULL")
        created=True
        port=int(docker("port",name,"3306/tcp").rsplit(":",1)[-1])
        for _ in range(90):
            try:
                db=pymysql.connect(host="127.0.0.1",port=port,user="root",
                    password=password,autocommit=True,connect_timeout=2)
                break
            except pymysql.MySQLError:
                time.sleep(1)
        if db is None:
            raise RuntimeError("LOCAL_MYSQL_NOT_READY")
        with db.cursor() as cur:
            cur.execute("CREATE DATABASE ingest_stage")
            cur.execute("CREATE TABLE ingest_stage.journeys "
                        "(id INT PRIMARY KEY, description VARCHAR(20)) ENGINE=InnoDB")
            cur.execute("SHOW BINARY LOG STATUS")
            start_file,start_pos,*_=cur.fetchone()
            cur.execute("INSERT INTO ingest_stage.journeys VALUES (1,'before')")
            cur.execute("ALTER TABLE ingest_stage.journeys ADD COLUMN changed INT NULL")
            cur.execute("INSERT INTO ingest_stage.journeys "
                        "(id,description,changed) VALUES (2,'after',1)")

        stream=BinLogStreamReader(
            connection_settings={"host":"127.0.0.1","port":port,
                "user":"root","passwd":password},
            server_id=91729999,log_file=start_file,log_pos=start_pos,
            resume_stream=True,blocking=False,
            only_schemas=["ingest_stage"],only_tables=["journeys"],
            only_events=[WriteRowsEvent,UpdateRowsEvent,DeleteRowsEvent,
                         XidEvent,RotateEvent,QueryEvent],
            freeze_schema=True)
        observed_commits=[]
        def capture(*args):
            observed_commits.append(args)
        events_seen={}
        query_types={}
        def observed_events():
            for event in stream:
                kind=type(event).__name__
                events_seen[kind]=events_seen.get(kind,0)+1
                if kind=="QueryEvent":
                    query=event.query
                    if isinstance(query,bytes):
                        query=query.decode("utf8",errors="replace")
                    # Only expose the SQL verb, never SQL statements or values.
                    verb=query.strip().split(None,1)[0].upper() if isinstance(query,str) and query.strip() else "EMPTY"
                    query_types[verb]=query_types.get(verb,0)+1
                yield event
        # The actual AWS RDS worker is intentionally restricted to
        # mysql-bin-changelog.NNNNNN; local Docker uses mysql-bin.NNNNNN.
        # Patch the pattern for this test only. Do not loosen production code.
        if not re.fullmatch(r"mysql-bin\.[0-9]{6}",start_file):
            raise AssertionError("UNEXPECTED_DISPOSABLE_BINLOG_NAME")
        with patch.object(worker,"FILE_NAME",
                          re.compile(r"^mysql-bin\.[0-9]{6}$")), \
             patch.object(worker,"commit",side_effect=capture):
            try:
                worker.consume_events(observed_events(),object(),start_file,0,7)
            except RuntimeError as error:
                if str(error)!="BINLOG_QUERY_EVENT_REQUIRES_SCHEMA_REVIEW":
                    print("OBSERVED_EVENT_TYPES:",sorted(events_seen.items()),flush=True)
                    print("OBSERVED_QUERY_VERBS:",sorted(query_types.items()),flush=True)
                    print("PRE_DDL_COMMIT_COUNT:",len(observed_commits),flush=True)
                    raise AssertionError(
                        "WORKER_FAILED_WITH_UNEXPECTED_REASON:"+str(error))
            else:
                print("OBSERVED_EVENT_TYPES:",sorted(events_seen.items()),flush=True)
                print("OBSERVED_QUERY_VERBS:",sorted(query_types.items()),flush=True)
                raise AssertionError("WORKER_DID_NOT_REJECT_DDL")
        if len(observed_commits)!=1:
            raise AssertionError("WORKER_DID_NOT_CAPTURE_PRE_DDL_COMMIT")
        if observed_commits[0][5]!=0 or observed_commits[0][3]!={"journeys"}:
            raise AssertionError("INCORRECT_PRE_DDL_CHECKPOINT")
        print("PASS: committed pre-DDL row transaction processed",flush=True)
        print("PASS: real MySQL ALTER TABLE QueryEvent triggers fail-closed guard",flush=True)
        print("PASS: no post-DDL transaction processed after schema drift",flush=True)
        print("NO AWS/RDS CONNECTIONS. NO CDC BASELINE. NO EC2 WORKER ENABLED.",flush=True)
    finally:
        if stream:
            try:stream.close()
            except Exception:pass
        if db:
            try:db.close()
            except Exception:pass
        if created:
            result=subprocess.run(["docker","rm","-f",name],capture_output=True,
                                  text=True,timeout=30)
            if result.returncode:
                print("CLEANUP_WARNING: local container "+name,file=sys.stderr)
            else:
                print("CLEANUP: disposable local DDL test container removed.",flush=True)


if __name__=="__main__":
    try:main()
    except Exception as error:
        safe=str(error) if isinstance(error,(RuntimeError,AssertionError)) else type(error).__name__
        print("CDC_LOCAL_DDL_TEST_FAILED:",safe,file=sys.stderr)
        sys.exit(1)
