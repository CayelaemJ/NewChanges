#!/usr/bin/env python3
"""Explicitly approved, one-time notification-only CDC baseline setup.

The dashboard reads historical records directly from MySQL's ten reporting
views. This baseline DOES NOT copy or re-snapshot those records. It only
captures a safe *starting boundary* for future invalidation events.

Run immediately before starting the approved worker; 48-hour binlog retention
means delayed activation may render this initial coordinate unrecoverable.
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path

REGION="eu-north-1"
HOST="fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com"
ACCOUNT="805068224616"
CA=Path(".local/certs/rds-global-bundle.pem")
SOURCE_ID="fixer_synthetic_mysql"
LOCK_NAME="fixer_cdc_meta:fixer_synthetic_mysql"
APPROVAL="I_APPROVE_NOTIFICATION_ONLY_BASELINE"
FEEDS=tuple(sorted({
 "debt_accounts","employees","employers","journeys","platform_users",
 "policies","ratings","referrals","salary_advances","workforce_snapshots",
}))
PATTERN=re.compile(r"^mysql-bin-changelog\.[0-9]{6}$")


def aws(*args):
 return subprocess.run(["aws",*args],capture_output=True,check=True,
                       text=True,timeout=20).stdout.rstrip("\r\n")


def run():
 if os.getenv("FIXER_CDC_BASELINE_APPROVAL")!=APPROVAL:
  raise RuntimeError("BASELINE_APPROVAL_REQUIRED")
 if os.getenv("AWS_DEFAULT_REGION")!=REGION or not CA.is_file():
  raise RuntimeError("REGION_OR_CA_MISMATCH")
 identity=json.loads(aws("sts","get-caller-identity","--output","json"))
 if identity.get("Account")!=ACCOUNT:
  raise RuntimeError("AWS_ACCOUNT_MISMATCH")
 instance=json.loads(aws("rds","describe-db-instances","--region",REGION,
  "--db-instance-identifier","fixer-synthetic-mysql","--query","DBInstances[0]",
  "--output","json"))
 if instance.get("Engine")!="mysql" or instance.get("DBInstanceStatus")!="available" or (
    instance.get("Endpoint",{}).get("Address")!=HOST):
  raise RuntimeError("RDS_IDENTITY_MISMATCH")
 import pymysql
 password=aws("ssm","get-parameter","--region",REGION,
  "--name","/fixer/staging/mysql/admin-password","--with-decryption",
  "--query","Parameter.Value","--output","text")
 db=pymysql.connect(host=HOST,port=3306,user="fixeradmin",password=password,
  ssl={"ca":str(CA.resolve()),"check_hostname":True},
  connect_timeout=10,read_timeout=15,write_timeout=15,autocommit=False)
 locked=False
 try:
  with db.cursor() as cur:
   cur.execute("SELECT GET_LOCK(%s,0)",(LOCK_NAME,))
   if cur.fetchone()[0]!=1:
    raise RuntimeError("ANOTHER_WORKER_HOLDS_SOURCE_LOCK")
   locked=True
   cur.execute("SELECT @@global.log_bin,@@global.binlog_format,@@global.binlog_row_image")
   if cur.fetchone()!=(1,"ROW","FULL"):
    raise RuntimeError("BINLOG_CONFIGURATION_INVALID")
   cur.execute("SELECT TABLE_NAME,TABLE_TYPE,ENGINE FROM information_schema.TABLES "
               "WHERE TABLE_SCHEMA='ingest_stage'")
   inventory={name:(kind,engine) for name,kind,engine in cur.fetchall()}
   for feed in FEEDS:
    if inventory.get(feed)!=("BASE TABLE","InnoDB"):
     raise RuntimeError("PHYSICAL_SOURCE_TABLE_MISSING")
    if inventory.get("v_"+feed,("",))[0]!="VIEW":
     raise RuntimeError("REPORTING_VIEW_MISSING")
   cur.execute("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES "
               "WHERE TABLE_SCHEMA='fixer_cdc_meta'")
   meta=dict(cur.fetchall())
   if meta!={"cdc_checkpoint":"InnoDB","cdc_feed_generation":"InnoDB",
             "cdc_commit_digest":"InnoDB"}:
    raise RuntimeError("METADATA_SCHEMA_INVALID")
   for table in ("cdc_checkpoint","cdc_feed_generation","cdc_commit_digest"):
    cur.execute("SELECT COUNT(*) FROM fixer_cdc_meta."+table)
    if cur.fetchone()[0]!=0:
     raise RuntimeError("METADATA_ALREADY_INITIALIZED")
   db.rollback()
   # This is the only starting coordinate the new worker may use. Capture it
   # before metadata INSERTs, so subsequent source commits remain replayable.
   cur.execute("SHOW BINARY LOG STATUS")
   name,position,*_=cur.fetchone()
   if not PATTERN.fullmatch(name) or int(position)<4:
    raise RuntimeError("BINLOG_START_INVALID")
   cur.execute("INSERT INTO fixer_cdc_meta.cdc_checkpoint "
    "(source_id,binlog_file,binlog_position,generation,fence_epoch,updated_at_utc) "
    "VALUES (%s,%s,%s,0,1,UTC_TIMESTAMP(6))",
    (SOURCE_ID,name,position))
   cur.executemany("INSERT INTO fixer_cdc_meta.cdc_feed_generation "
    "(source_id,feed,generation) VALUES (%s,%s,0)",
    [(SOURCE_ID,f) for f in FEEDS])
   db.commit()
   print("PASS: approved metadata-only checkpoint created for",SOURCE_ID)
   print("PASS: 10 zero-generation feed rows initialized")
   print("BOOTSTRAP_BOUNDARY:",name,position)
   print("NO SOURCE ROW COPIES. Start worker before retention expires.")
 except Exception:
  db.rollback()
  raise
 finally:
  if locked:
   try:
    with db.cursor() as cur:
     cur.execute("SELECT RELEASE_LOCK(%s)",(LOCK_NAME,))
    db.commit()
   except Exception:
    pass
  db.close()


if __name__=="__main__":
 try:run()
 except Exception as exc:
  safe=str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__
  print("BASELINE_SETUP_FAILED:",safe,file=sys.stderr)
  sys.exit(1)
