#!/usr/bin/env python3
"""Install the reviewed manual CDC worker on the existing EC2 as a DISABLED service.

Uses the locally checked-out worker source in the PR branch, transfers it
through SSM Run Command, verifies SHA256, and configures a disabled systemd unit.
NO baseline initialization; NO service activation; NO RDS writes.
"""
import base64
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import tempfile
import time

ACCOUNT="805068224616"
REGION="eu-north-1"
INSTANCE="i-0b962bdca3305346d"
ROOT=pathlib.Path(__file__).resolve().parent.parent
WORKER=ROOT/"scripts/cdc-rds-staging-manual-worker.py"
SERVICE="""[Unit]
Description=The Fixer MySQL CDC staging metadata worker
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=fixercdc
Group=fixercdc
WorkingDirectory=/opt/fixer-cdc
Environment=AWS_DEFAULT_REGION=eu-north-1
Environment=AWS_PAGER=
# Deliberately omit FIXER_CDC_WORKER_ACTIVATE; default fails closed.
ExecStart=/opt/fixer-cdc/venv/bin/python /opt/fixer-cdc/worker.py
Restart=no
TimeoutStopSec=20
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
ReadWritePaths=/opt/fixer-cdc
UMask=0077
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
"""


def aws(*args,timeout=45):
    p=subprocess.run(["aws",*args],capture_output=True,text=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError("AWS_COMMAND_FAILED")
    return p.stdout.strip()


def main():
    if os.environ.get("AWS_DEFAULT_REGION")!=REGION:
        raise RuntimeError("AWS_REGION_MISMATCH")
    ident=json.loads(aws("sts","get-caller-identity","--output","json"))
    if ident.get("Account")!=ACCOUNT:
        raise RuntimeError("AWS_ACCOUNT_MISMATCH")
    if not WORKER.is_file():
        raise RuntimeError("WORKER_FILE_MISSING")
    source=WORKER.read_bytes()
    if b"WORKER_MANUALLY_DISABLED" not in source or b"I_APPROVE_MANUAL_CDC_WORKER" not in source:
        raise RuntimeError("WORKER_ACTIVATION_GUARD_MISSING")
    sha=hashlib.sha256(source).hexdigest()
    encoded=base64.b64encode(source).decode("ascii")
    unit=base64.b64encode(SERVICE.encode()).decode()
    # Do not modify the existing app or its containerized workloads.
    commands=[
        "set -eu",
        "test -x /opt/fixer-cdc/venv/bin/python",
        "test -s /opt/fixer-cdc/rds-global-bundle.pem",
        "id -u fixercdc >/dev/null 2>&1 || useradd --system --home-dir /opt/fixer-cdc --shell /sbin/nologin fixercdc",
        "test \"$(systemctl is-active fixer-cdc-worker.service 2>/dev/null || true)\" != active",
        "mkdir -p /opt/fixer-cdc/.local/certs",
        "cp /opt/fixer-cdc/rds-global-bundle.pem /opt/fixer-cdc/.local/certs/rds-global-bundle.pem",
        "printf '%s' '"+encoded+"' | base64 -d > /opt/fixer-cdc/worker.py.new",
        "echo '"+sha+"  /opt/fixer-cdc/worker.py.new' | sha256sum -c -",
        "/opt/fixer-cdc/venv/bin/python -m py_compile /opt/fixer-cdc/worker.py.new",
        "mv /opt/fixer-cdc/worker.py.new /opt/fixer-cdc/worker.py",
        "chmod 750 /opt/fixer-cdc/worker.py",
        "chown -R fixercdc:fixercdc /opt/fixer-cdc",
        "printf '%s' '"+unit+"' | base64 -d > /etc/systemd/system/fixer-cdc-worker.service",
        "chmod 644 /etc/systemd/system/fixer-cdc-worker.service",
        "systemctl daemon-reload",
        "systemctl disable fixer-cdc-worker.service >/dev/null 2>&1 || true",
        "test \"$(systemctl is-enabled fixer-cdc-worker.service 2>/dev/null || true)\" = disabled",
        "test \"$(systemctl is-active fixer-cdc-worker.service 2>/dev/null || true)\" != active",
        "echo WORKER_SHA256="+sha,
        "echo UNIT_STATE=$(systemctl is-enabled fixer-cdc-worker.service)",
        "echo SERVICE_STATE=$(systemctl is-active fixer-cdc-worker.service || true)",
        "echo WORKER_INSTALLED_BUT_NOT_ACTIVATED",
    ]
    payload={
        "InstanceIds":[INSTANCE],
        "DocumentName":"AWS-RunShellScript",
        "Comment":"Install disabled staging CDC worker; no baseline or replication",
        "TimeoutSeconds":180,
        "Parameters":{"commands":commands},
    }
    with tempfile.NamedTemporaryFile(mode="w",suffix=".json",delete=False) as f:
        os.chmod(f.name,0o600)
        json.dump(payload,f)
        path=f.name
    try:
        result=json.loads(aws("ssm","send-command","--region",REGION,
            "--cli-input-json","file://"+path,"--output","json"))
    finally:
        os.unlink(path)
    command=result["Command"]["CommandId"]
    print("SSM command:",command)
    for _ in range(100):
        try:
            invocation=json.loads(aws("ssm","get-command-invocation",
                "--region",REGION,"--command-id",command,
                "--instance-id",INSTANCE,"--output","json"))
        except RuntimeError:
            time.sleep(2)
            continue
        status=invocation.get("Status")
        if status in {"Success","Failed","TimedOut","Cancelled"}:
            print("Status:",status)
            print(invocation.get("StandardOutputContent",""))
            if status!="Success":
                print(invocation.get("StandardErrorContent",""),file=sys.stderr)
                raise RuntimeError("EC2_INSTALL_UNSUCCESSFUL")
            return
        time.sleep(2)
    raise RuntimeError("INSTALL_STATUS_UNRESOLVED_CHECK_SSM_COMMAND")


if __name__=="__main__":
    try:
        main()
    except Exception as error:
        print("CDC_EC2_INSTALL_FAILED:",
              str(error) if isinstance(error,RuntimeError) else type(error).__name__,
              file=sys.stderr)
        sys.exit(1)
