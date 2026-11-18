#!/usr/bin/env python3
"""Disposable LOCAL MySQL 8.4 InnoDB worker-checkpoint integration.

No AWS, no RDS, no Railway, no source business records. Starts a temporary
loopback-only Docker MySQL container, exercises real transactions against the
manual worker's commit/resume functions, and removes the container afterwards.
Requires explicit approval to use LOCAL Docker resources.
"""
import importlib.util
import os
import secrets
import subprocess
import sys
import time
from pathlib import Path

APPROVAL="I_APPROVE_LOCAL_DOCKER_ONLY"
HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location(
    "fixer_disposable_worker",HERE/"cdc-rds-staging-manual-worker.py")
worker=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(worker)


def docker(*args, timeout=30):
    p=subprocess.run(["docker",*args],capture_output=True,text=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError("LOCAL_DOCKER_COMMAND_FAILED")
    return p.stdout.strip()


def sql(db, statement, args=()):
    with db.cursor() as cur:
        cur.execute(statement,args)
        return cur.fetchall()


def checkpoint(db):
    row=sql(db,"SELECT binlog_file,binlog_position,generation,fence_epoch "
               "FROM fixer_cdc_meta.cdc_checkpoint WHERE source_id=%s",
            (worker.SOURCE_ID,))
    if len(row)!=1:
        raise AssertionError("CHECKPOINT_INVENTORY_INVALID")
    return row[0]


def assert_state(db, generation, journeys, employees, digests):
    row=checkpoint(db)
    assert int(row[2])==generation, "checkpoint generation mismatch"
    feeds=dict(sql(db,"SELECT feed,generation FROM fixer_cdc_meta.cdc_feed_generation"))
    assert len(feeds)==10, "feed inventory mismatch"
    assert int(feeds["journeys"])==journeys
    assert int(feeds["employees"])==employees
    assert all(int(v)==0 for k,v in feeds.items() if k not in ("journeys","employees"))
    assert int(sql(db,"SELECT COUNT(*) FROM fixer_cdc_meta.cdc_commit_digest")[0][0])==digests
    return row


def main():
    if os.getenv("FIXER_CDC_DOCKER_CHECKPOINT_TEST")!=APPROVAL:
        raise RuntimeError("LOCAL_DOCKER_TEST_APPROVAL_REQUIRED")
    import pymysql

    name="fixer-cdc-checkpoint-"+secrets.token_hex(10)
    password="local-only-"+secrets.token_hex(24)
    container=None
    db=None
    next_db=None
    try:
        container=docker("run","-d","--rm","--name",name,
            "-e","MYSQL_ROOT_PASSWORD="+password,
            "-p","127.0.0.1::3306",
            "mysql:8.4","--server-id=91729991","--log-bin=mysql-bin")
        port_text=docker("port",name,"3306/tcp")
        port=int(port_text.rsplit(":",1)[-1])
        for _ in range(90):
            try:
                db=pymysql.connect(host="127.0.0.1",port=port,user="root",
                    password=password,autocommit=False,connect_timeout=2)
                break
            except pymysql.MySQLError:
                time.sleep(1)
        if db is None:
            raise RuntimeError("LOCAL_MYSQL_NOT_READY")
        sql(db,"CREATE DATABASE fixer_cdc_meta")
        sql(db,"CREATE TABLE fixer_cdc_meta.cdc_checkpoint ("
               "source_id VARCHAR(100) PRIMARY KEY,binlog_file VARCHAR(128) NOT NULL,"
               "binlog_position BIGINT UNSIGNED NOT NULL,generation BIGINT UNSIGNED NOT NULL,"
               "fence_epoch BIGINT UNSIGNED NOT NULL,updated_at_utc DATETIME(6) NOT NULL"
               ") ENGINE=InnoDB")
        sql(db,"CREATE TABLE fixer_cdc_meta.cdc_feed_generation ("
               "source_id VARCHAR(100) NOT NULL,feed VARCHAR(64) NOT NULL,"
               "generation BIGINT UNSIGNED NOT NULL,PRIMARY KEY(source_id,feed),"
               "FOREIGN KEY(source_id) REFERENCES fixer_cdc_meta.cdc_checkpoint(source_id)"
               ") ENGINE=InnoDB")
        sql(db,"CREATE TABLE fixer_cdc_meta.cdc_commit_digest ("
               "source_id VARCHAR(100) NOT NULL,binlog_file VARCHAR(128) NOT NULL,"
               "binlog_position BIGINT UNSIGNED NOT NULL,"
               "digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,"
               "PRIMARY KEY(source_id,binlog_file,binlog_position),"
               "FOREIGN KEY(source_id) REFERENCES fixer_cdc_meta.cdc_checkpoint(source_id)"
               ") ENGINE=InnoDB")
        sql(db,"INSERT INTO fixer_cdc_meta.cdc_checkpoint "
               "VALUES (%s,%s,%s,%s,%s,UTC_TIMESTAMP(6))",
               (worker.SOURCE_ID,"mysql-bin-changelog.000001",4,0,1))
        with db.cursor() as cur:
            cur.executemany("INSERT INTO fixer_cdc_meta.cdc_feed_generation VALUES (%s,%s,0)",
                            [(worker.SOURCE_ID,feed) for feed in worker.FEEDS])
        db.commit()
        print("PASS: isolated LOCAL MySQL 8.4 metadata tables initialized",flush=True)

        worker.acquire_lock(db)
        worker.commit(db,"mysql-bin-changelog.000001",100,{"journeys"},"a"*64,0,1)
        row=assert_state(db,1,1,0,1)
        assert int(row[1])==100
        print("PASS: real InnoDB atomic commit advances checkpoint, feed and digest",flush=True)

        try:
            worker.commit(db,"mysql-bin-changelog.000001",100,{"journeys"},"a"*64,0,1)
            raise AssertionError("duplicate unexpectedly accepted")
        except RuntimeError as exc:
            assert str(exc)=="STALE_WORKER_OR_GENERATION"
        assert_state(db,1,1,0,1)
        print("PASS: duplicate checkpoint commit fails closed with no additional writes",flush=True)

        try:
            worker.commit(db,"mysql-bin-changelog.000001",120,{"employees"},"b"*64,0,1)
            raise AssertionError("stale worker unexpectedly accepted")
        except RuntimeError as exc:
            assert str(exc)=="STALE_WORKER_OR_GENERATION"
        assert_state(db,1,1,0,1)
        print("PASS: stale generation cannot write metadata",flush=True)

        # Simulate a crash after SQL writes but before database COMMIT.
        sql(db,"START TRANSACTION")
        sql(db,"INSERT INTO fixer_cdc_meta.cdc_commit_digest VALUES (%s,%s,%s,%s)",
            (worker.SOURCE_ID,"mysql-bin-changelog.000001",110,"c"*64))
        sql(db,"UPDATE fixer_cdc_meta.cdc_feed_generation SET generation=generation+1 "
               "WHERE source_id=%s AND feed='employees'",(worker.SOURCE_ID,))
        db.rollback()
        assert_state(db,1,1,0,1)
        print("PASS: uncommitted digest/feed update rolls back atomically",flush=True)

        # Simulate worker connection loss: MySQL releases advisory lock.
        db.close()
        db=None
        next_db=pymysql.connect(host="127.0.0.1",port=port,user="root",
            password=password,autocommit=False,connect_timeout=3)
        worker.acquire_lock(next_db)
        prior=sql(next_db,"SELECT source_id,binlog_file,binlog_position,generation,fence_epoch "
                "FROM fixer_cdc_meta.cdc_checkpoint WHERE source_id=%s",
                (worker.SOURCE_ID,))[0]
        filename,pos,generation,epoch=worker.resume(next_db,prior)
        assert epoch==2 and generation==1 and pos==100
        worker.commit(next_db,filename,200,{"employees"},"d"*64,generation,epoch)
        row=assert_state(next_db,2,1,1,2)
        assert int(row[4-1])==2
        print("PASS: restart increments fence epoch and resumes from durable checkpoint",flush=True)

        try:
            worker.commit(next_db,filename,240,{"journeys"},"e"*64,2,1)
            raise AssertionError("old leader accepted")
        except RuntimeError as exc:
            assert str(exc)=="STALE_WORKER_OR_GENERATION"
        assert_state(next_db,2,1,1,2)
        print("PASS: stale fencing epoch rejected by real InnoDB checkpoint",flush=True)
        # Simulate a lost COMMIT response *before* the server commits.
        # The worker must rollback, and the durable checkpoint stays at gen 2.
        class BeforeCommitFailure:
            def __init__(self, underlying):
                self.db=underlying
            def cursor(self):
                return self.db.cursor()
            def commit(self):
                raise ConnectionError("simulated response failure before commit")
            def rollback(self):
                return self.db.rollback()

        try:
            worker.commit(BeforeCommitFailure(next_db),
                          filename,300,{"journeys"},"f"*64,2,2)
            raise AssertionError("pre-commit failure unexpectedly succeeded")
        except ConnectionError:
            pass
        assert_state(next_db,2,1,1,2)
        print("PASS: failed pre-COMMIT response leaves durable metadata unchanged",
              flush=True)

        # Simulate MySQL committing durably but losing the acknowledgement.
        # Recovery must inspect the persisted checkpoint, NOT blindly retry
        # the same transaction or publish another generation.
        class AfterCommitFailure(BeforeCommitFailure):
            def commit(self):
                self.db.commit()
                raise ConnectionError("simulated lost COMMIT acknowledgement")

        try:
            worker.commit(AfterCommitFailure(next_db),
                          filename,320,{"journeys"},"g"*64,2,2)
            raise AssertionError("ambiguous post-commit result unexpectedly succeeded")
        except ConnectionError:
            pass
        row=assert_state(next_db,3,2,1,3)
        assert int(row[1])==320
        next_db.close()
        next_db=None

        # A fresh connection sees the committed checkpoint and takes epoch 3.
        next_db=pymysql.connect(host="127.0.0.1",port=port,user="root",
            password=password,autocommit=False,connect_timeout=3)
        worker.acquire_lock(next_db)
        persisted=sql(next_db,"SELECT source_id,binlog_file,binlog_position,"
                      "generation,fence_epoch FROM fixer_cdc_meta.cdc_checkpoint "
                      "WHERE source_id=%s",(worker.SOURCE_ID,))[0]
        resumed=worker.resume(next_db,persisted)
        assert resumed==(filename,320,3,3)
        assert_state(next_db,3,2,1,3)
        print("PASS: lost COMMIT acknowledgement reconciles from durable checkpoint "
              "without duplicate generation",flush=True)
        print("LIMITATION: actual binlog rotation, daemon lifecycle and network "
              "disconnects still require integration tests.",flush=True)
        print("NO AWS/RDS CONNECTIONS. NO REPORTING RECORDS COPIED.",flush=True)
    finally:
        if db is not None:
            try:db.close()
            except Exception:pass
        if next_db is not None:
            try:next_db.close()
            except Exception:pass
        if container:
            p=subprocess.run(["docker","rm","-f",name],
                capture_output=True,text=True,timeout=30)
            if p.returncode!=0:
                print("CLEANUP_WARNING: inspect local Docker container "+name,
                      file=sys.stderr)
            else:
                print("CLEANUP: disposable local MySQL container removed.")


if __name__=="__main__":
    try:main()
    except Exception as e:
        safe=str(e) if isinstance(e,(RuntimeError,AssertionError)) else type(e).__name__
        print("CHECKPOINT_INTEGRATION_FAILED:",safe,file=sys.stderr)
        sys.exit(1)
