#!/usr/bin/env python3
"""Read-only EC2 CDC runtime verification, dispatched through AWS SSM Run Command.

Runs using the instance role; no SSH and no secret material is printed.
Never initializes a checkpoint, deploys a daemon, or modifies MySQL.
"""
import base64
import json
import os
import subprocess
import sys
import tempfile

INSTANCE="i-0b962bdca3305346d"
ACCOUNT="805068224616"
REGION="eu-north-1"
REMOTE=r'''
import json
import os
import subprocess
import sys

import pymysql
import pymysqlreplication

HOST="fixer-synthetic-mysql.cxeu8cgqwn8v.eu-north-1.rds.amazonaws.com"
CA="/opt/fixer-cdc/rds-global-bundle.pem"
REGION="eu-north-1"

def aws(*args):
    result=subprocess.run(["aws",*args],capture_output=True,text=True,timeout=20)
    if result.returncode:
        raise RuntimeError("INSTANCE_AWS_ACCESS_FAILED")
    return result.stdout.rstrip("\r\n")

def password(u):
    return aws("ssm","get-parameter","--region",REGION,"--with-decryption",
               "--name","/fixer/staging/mysql/"+u.replace("_","-")+"-password",
               "--query","Parameter.Value","--output","text")

def connect(u,secret):
    return pymysql.connect(host=HOST,port=3306,user=u,password=secret,
        ssl={"ca":CA,"check_hostname":True},
        connect_timeout=9,read_timeout=12,write_timeout=12,autocommit=True)

def main():
    if not os.path.isfile(CA):
        raise RuntimeError("RDS_CA_MISSING")
    identity=json.loads(aws("sts","get-caller-identity","--output","json"))
    if identity.get("Account")!="805068224616":
        raise RuntimeError("INSTANCE_ACCOUNT_MISMATCH")
    for user in ("fixer_cdc_reader","fixer_cdc_writer"):
        db=None
        try:
            db=connect(user,password(user))
            with db.cursor() as cur:
                cur.execute("SELECT CURRENT_USER(), @@global.log_bin, @@global.binlog_format, @@global.binlog_row_image")
                login,enabled,format_,image=cur.fetchone()
                if login!=user+"@%" or enabled!=1 or format_!="ROW" or image!="FULL":
                    raise RuntimeError("MYSQL_IDENTITY_OR_BINLOG_INVALID")
                if user=="fixer_cdc_reader":
                    cur.execute("SHOW BINARY LOG STATUS")
                    result=cur.fetchone()
                    if not result or not result[0]:
                        raise RuntimeError("BINLOG_STATUS_UNAVAILABLE")
                    print("PASS: EC2 CDC reader connected with verified TLS and ROW/FULL")
                    print("BINLOG_OBSERVATION:", result[0], int(result[1]), "(NOT A CHECKPOINT)")
                else:
                    for table in ("cdc_checkpoint","cdc_feed_generation","cdc_commit_digest"):
                        cur.execute("SELECT COUNT(*) FROM fixer_cdc_meta."+table)
                        total=cur.fetchone()[0]
                        print("METADATA:",table,"rows=",total)
                    print("PASS: EC2 metadata writer connected with verified TLS")
        finally:
            if db is not None:
                db.close()
    print("PASS: EC2 runtime, instance credentials and private RDS connectivity verified")
    print("NO DATABASE WRITES. NO BASELINE. NO WORKER ENABLED.")

try:
    main()
except Exception as exc:
    safe=str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__
    print("EC2_CDC_RUNTIME_CHECK_FAILED:",safe,file=sys.stderr)
    sys.exit(1)
'''

def cli(*args):
    p=subprocess.run(["aws",*args],capture_output=True,text=True,timeout=30)
    if p.returncode:
        raise RuntimeError("LOCAL_AWS_CLI_FAILED")
    return p.stdout.strip()

def main():
    if os.environ.get("AWS_DEFAULT_REGION")!=REGION:
        raise RuntimeError("AWS_REGION_MISMATCH")
    caller=json.loads(cli("sts","get-caller-identity","--output","json"))
    if caller.get("Account")!=ACCOUNT:
        raise RuntimeError("AWS_ACCOUNT_MISMATCH")
    encoded=base64.b64encode(REMOTE.encode("utf8")).decode("ascii")
    command=("printf '%s' '"+encoded+"' | base64 -d | "
             "/opt/fixer-cdc/venv/bin/python -")
    payload={
        "InstanceIds":[INSTANCE],"DocumentName":"AWS-RunShellScript",
        "Comment":"Read-only Fixer CDC EC2-to-RDS TLS and SSM verification",
        "Parameters":{"commands":["set -eu",command]},
        "TimeoutSeconds":120,
    }
    fd,path=tempfile.mkstemp(prefix="fixer-cdc-ec2-probe-",suffix=".json")
    try:
        with os.fdopen(fd,"w") as fh:
            json.dump(payload,fh)
        output=json.loads(cli("ssm","send-command","--region",REGION,
            "--cli-input-json","file://"+path,"--output","json"))
        command_id=output["Command"]["CommandId"]
    finally:
        os.unlink(path)
    print("SSM command:",command_id)
    # Polling through get-command-invocation avoids the SSM waiter's short
    # max-attempt limit on heavily loaded instances.
    import time
    for _ in range(90):
        try:
            invocation=json.loads(cli("ssm","get-command-invocation",
                "--command-id",command_id,"--instance-id",INSTANCE,
                "--region",REGION,"--output","json"))
        except RuntimeError:
            time.sleep(2)
            continue
        state=invocation.get("Status")
        if state in ("Success","Failed","TimedOut","Cancelled","Cancelling"):
            print("SSM status:",state)
            print(invocation.get("StandardOutputContent",""))
            if state!="Success":
                print(invocation.get("StandardErrorContent",""),file=sys.stderr)
                sys.exit(1)
            return
        time.sleep(2)
    raise RuntimeError("SSM_COMMAND_STILL_PENDING_CHECK_COMMAND_ID")

if __name__=="__main__":
    try:
        main()
    except Exception as exc:
        message=str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__
        print("EC2_PROBE_DISPATCH_FAILED:",message,file=sys.stderr)
        sys.exit(1)
