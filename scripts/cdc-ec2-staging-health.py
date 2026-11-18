#!/usr/bin/env python3
"""Read-only EC2 staging CDC health check via AWS Systems Manager.

No baseline writes, no worker activation, no data rows, no secret output.
Reports explicitly NOT_INITIALIZED when checkpoint tables are empty; this is
not interchangeable with healthy real-time replication.
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
import time

REGION="eu-north-1"
ACCOUNT="805068224616"
INSTANCE="i-0b962bdca3305346d"
REMOTE=r'''
import json
import subprocess
import sys
import pymysql

def command(args):
    result=subprocess.run(args,check=False,text=True,capture_output=True,timeout=20)
    return result.returncode,result.stdout.strip()

def aws(*args):
    code,value=command(["aws",*args])
    if code:raise RuntimeError("INSTANCE_AWS_ACCESS_FAILED")
    return value

def main():
    enabled=command(["systemctl","is-enabled","fixer-cdc-worker.service"])[1]
    active=command(["systemctl","is-active","fixer-cdc-worker.service"])[1]
    identity=json.loads(aws("sts","get-caller-identity","--output","json"))
    if identity.get("Account")!="805068224616":
        raise RuntimeError("INSTANCE_ACCOUNT_MISMATCH")
    credential=aws("ssm","get-parameter","--region","eu-north-1",
        "--name","/fixer/staging/mysql/fixer-cdc-writer-password",
        "--with-decryption","--query","Parameter.Value","--output","text")
    db=pymysql.connect(
        host="fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com",
        port=3306,user="fixer_cdc_writer",password=credential,
        ssl={"ca":"/opt/fixer-cdc/rds-global-bundle.pem","check_hostname":True},
        connect_timeout=10,read_timeout=10,autocommit=True)
    try:
        with db.cursor() as cur:
            cur.execute("SELECT binlog_file,binlog_position,generation,fence_epoch,"
                "updated_at_utc FROM fixer_cdc_meta.cdc_checkpoint "
                "WHERE source_id=%s",("fixer_synthetic_mysql",))
            rows=cur.fetchall()
            cur.execute("SELECT COUNT(*) FROM fixer_cdc_meta.cdc_feed_generation "
                "WHERE source_id=%s",("fixer_synthetic_mysql",))
            count=int(cur.fetchone()[0])
    finally:
        db.close()
    if len(rows)>1:
        raise RuntimeError("INVALID_CHECKPOINT_CARDINALITY")
    if not rows:
        state="NOT_INITIALIZED"
        if count:
            raise RuntimeError("ORPHANED_FEED_GENERATIONS")
        if active=="active":
            raise RuntimeError("ACTIVE_WITHOUT_BASELINE")
        summary={"state":state,"enabled":enabled,"active":active,
            "checkpoints":0,"feed_rows":count}
    else:
        row=rows[0]
        if count!=10:
            raise RuntimeError("INVALID_FEED_INVENTORY")
        summary={"state":"BASELINED_ACTIVE" if active=="active" else "BASELINED_NOT_RUNNING",
            "enabled":enabled,"active":active,"checkpoints":1,
            "feed_rows":count,"binlog_file":row[0],
            "binlog_position":int(row[1]),"generation":int(row[2]),
            "fence_epoch":int(row[3]),"checkpoint_updated_utc":str(row[4])}
    print("CDC_HEALTH:",json.dumps(summary,sort_keys=True))
    print("NOTE: idle checkpoints alone do not prove replication lag or health.")
    print("NO DATABASE WRITES. NO WORKER ACTIVATION.")

try:
    main()
except Exception as e:
    msg=str(e) if isinstance(e,RuntimeError) else type(e).__name__
    print("CDC_HEALTH_CHECK_FAILED:",msg,file=sys.stderr)
    sys.exit(1)
'''

def cli(*args):
    p=subprocess.run(["aws",*args],capture_output=True,text=True,timeout=35)
    if p.returncode:
        raise RuntimeError("AWS_COMMAND_FAILED")
    return p.stdout.strip()

def main():
    if os.getenv("AWS_DEFAULT_REGION")!=REGION:
        raise RuntimeError("AWS_REGION_MISMATCH")
    user=json.loads(cli("sts","get-caller-identity","--output","json"))
    if user.get("Account")!=ACCOUNT:
        raise RuntimeError("AWS_ACCOUNT_MISMATCH")
    encoded=base64.b64encode(REMOTE.encode()).decode()
    command="printf '%s' '"+encoded+"' | base64 -d | /opt/fixer-cdc/venv/bin/python -"
    request={"InstanceIds":[INSTANCE],"DocumentName":"AWS-RunShellScript",
        "Comment":"Read-only Fixer CDC operational checkpoint and systemd health",
        "Parameters":{"commands":["set -eu",command]},"TimeoutSeconds":120}
    fd,path=tempfile.mkstemp(prefix="fixer-cdc-health-",suffix=".json")
    try:
        with os.fdopen(fd,"w") as fh:json.dump(request,fh)
        result=json.loads(cli("ssm","send-command","--region",REGION,
            "--cli-input-json","file://"+path,"--output","json"))
        cmd=result["Command"]["CommandId"]
    finally:
        os.unlink(path)
    print("SSM command:",cmd,flush=True)
    for _ in range(90):
        time.sleep(2)
        p=subprocess.run(["aws","ssm","get-command-invocation",
            "--region",REGION,"--command-id",cmd,"--instance-id",INSTANCE,
            "--output","json"],capture_output=True,text=True,timeout=35)
        if p.returncode:continue
        status=json.loads(p.stdout)
        if status["Status"] in ("Success","Failed","TimedOut","Cancelled"):
            print("Status:",status["Status"])
            print(status.get("StandardOutputContent",""))
            if status["Status"]!="Success":
                print(status.get("StandardErrorContent",""),file=sys.stderr)
                raise RuntimeError("REMOTE_HEALTH_CHECK_FAILED")
            return
    raise RuntimeError("SSM_COMMAND_STILL_PENDING")

if __name__=="__main__":
    try:main()
    except Exception as e:
        msg=str(e) if isinstance(e,RuntimeError) else type(e).__name__
        print("CDC_HEALTH_DISPATCH_FAILED:",msg,file=sys.stderr)
        sys.exit(1)
