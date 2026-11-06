"""Disabled-by-default Lambda entry point for scheduled simulation and CDC drains."""
import json
import os
from datetime import datetime, timezone

from .common import redacted_error


def _install_secret():
    """Secret must be manually supplied through Secrets Manager after cost approval."""
    secret_id = os.environ.get("SIM_SECRET_ID")
    if not secret_id:
        raise RuntimeError("SIM_SECRET_ID not configured")
    import boto3
    obj = boto3.client("secretsmanager").get_secret_value(SecretId=secret_id)
    data = json.loads(obj["SecretString"])
    permitted = ("SIM_DB_", "SIM_CDC_", "SIM_REPL_")
    for key, value in data.items():
        if not isinstance(key,str) or not key.startswith(permitted) or not isinstance(value,str):
            raise RuntimeError("Invalid secret key or value type")
        os.environ[key] = value


def handler(event, context):
    mode = event.get("mode") if isinstance(event,dict) else None
    if mode not in {"generate","cdc"}:
        raise ValueError("Invalid handler mode")
    # Environment kill-switch is checked *before* any secret/DB requests.
    if os.environ.get("SIM_LAMBDA_ENABLED") != "true":
        return {"status":"DISABLED"}
    _install_secret()
    try:
        if mode == "generate":
            # Use the scheduled-time token to prevent a Lambda retry creating a new run.
            scheduled_time = event.get("scheduled_time", "")
            if not isinstance(scheduled_time,str) or not scheduled_time:
                raise ValueError("Missing stable scheduled_time; manual callers must provide one")
            datetime.fromisoformat(scheduled_time.replace("Z","+00:00"))
            key = "sched:" + scheduled_time.replace("+00:00", "Z").replace(".", "_")
            from .simulator import run
            outcome = run(run_key=key)
        else:
            from .cdc import run
            outcome = run()
        # CloudWatch Embedded Metric Format, no identifiers, PII or secrets.
        metric_name = "Inserted" if mode=="generate" else "CDCEvents"
        metric_value = (outcome.get("statistics") or {}).get("insert",0) if mode=="generate" else outcome.get("events_processed",0)
        metrics = [{"Name":metric_name,"Unit":"Count"}]
        values = {metric_name: metric_value}
        if mode=="generate":
            stats = outcome.get("statistics") or {}
            values.update({"Updated":stats.get("update",0),
                           "Deleted":stats.get("physical_delete",0),
                           "FailedTransactions":stats.get("failed_transactions",0)})
            metrics.extend({"Name":name,"Unit":"Count"} for name in ("Updated","Deleted","FailedTransactions"))
        else:
            from .common import connect
            sink = connect("cdc")
            try:
                with sink.cursor() as cur:
                    cur.execute("SELECT GREATEST(0,COALESCE(last_event_age_seconds,0)) FROM v_cdc_latency")
                    latency = int(cur.fetchone()[0])
            finally:sink.close()
            values["CDCLastEventAgeSeconds"] = latency
            metrics.append({"Name":"CDCLastEventAgeSeconds","Unit":"Seconds"})
        print(json.dumps({"_aws":{"Timestamp":int(datetime.now(timezone.utc).timestamp()*1000),
             "CloudWatchMetrics":[{"Namespace":"FixerSynthetic","Dimensions":[["Mode"]],
             "Metrics":metrics}]},"Mode":mode,**values,"status":outcome["status"]}))
        return outcome
    except Exception as exc:
        # No raw driver diagnostics in CloudWatch; may contain connection information.
        print(json.dumps({"mode":mode,"status":"FAILED","error_type":redacted_error(exc)}))
        raise RuntimeError(f"Synthetic worker failed ({redacted_error(exc)})") from None
