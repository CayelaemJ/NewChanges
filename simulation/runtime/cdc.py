"""Real MySQL row-binlog reader -> transactional Bronze/Silver/Gold materialisations.

The reader cannot filter binlog data at the MySQL privilege boundary. USE only
on instances approved for replication exposure. Scoped writes are enforced.
"""
import json
import os
import sys
import time
from datetime import datetime, timezone
from decimal import Decimal

from .common import connect, connection_config, positive_int, redacted_error, utcnow
from .logic import allowed_table, encode, event_id

class CdcBootstrapStageError(RuntimeError):
    """Unexpected runtime failure during one non-sensitive bootstrap phase."""

    ALLOWED_STAGES = frozenset({
        "SOURCE_CONNECT", "SINK_CONNECT", "SIMULATION_STOP",
        "EMPTY_SOURCE", "BINLOG_PREFLIGHT", "SINK_CHECKPOINT",
        "CHECKPOINT_WRITE",
    })

    def __init__(self, stage):
        if stage not in self.ALLOWED_STAGES:
            raise ValueError("Unexpected CDC bootstrap stage")
        self.stage = stage
        super().__init__("CDC bootstrap failed in a restricted stage")


class CdcReadinessError(RuntimeError):
    """Controlled diagnostic identifier; never contains SQL, credentials, or server details."""

    ALLOWED = frozenset({
        "CDC_APPROVAL_REQUIRED", "CDC_SIMULATION_NOT_STOPPED",
        "CDC_SOURCE_NOT_EMPTY", "CDC_LOG_CONFIG_UNSUPPORTED",
        "CDC_BINLOG_STATUS_EMPTY", "CDC_CHECKPOINT_ALREADY_EXISTS",
    })

    def __init__(self, code):
        if code not in self.ALLOWED:
            raise ValueError("Unsupported CDC diagnostic")
        self.code = code
        super().__init__(code)


LOCK_NAME = "fixer_sim_analytics.cdc.v1"
CONSUMER = "fixer-sim-v1"


def query(db, sql, params=()):
    with db.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def write(db, sql, params=()):
    with db.cursor() as cur:
        return cur.execute(sql, params)


def preflight():
    db = connect("replica")
    try:
        mode = query(db, "SELECT @@GLOBAL.log_bin, @@GLOBAL.binlog_format, @@GLOBAL.binlog_row_image")
        if not mode or int(mode[0][0]) != 1 or str(mode[0][1]).upper() != "ROW" or str(mode[0][2]).upper() != "FULL":
            raise CdcReadinessError("CDC_LOG_CONFIG_UNSUPPORTED")
        status = query(db, "SHOW BINARY LOG STATUS")
        if not status:
            raise CdcReadinessError("CDC_BINLOG_STATUS_EMPTY")
        return status[0][0], int(status[0][1])
    finally:
        db.close()


def bootstrap_empty_source():
    """Only valid before first simulation row. Refuses unsafe skip over existing data."""
    if os.environ.get("SIM_CDC_BOOTSTRAP_APPROVED") != "YES_EMPTY_SOURCE_ONLY":
        raise CdcReadinessError("CDC_APPROVAL_REQUIRED")
    source = None
    sink = None
    stage = "SOURCE_CONNECT"
    try:
        source = connect("replica")
        stage = "SINK_CONNECT"
        sink = connect("cdc")
        stage = "SIMULATION_STOP"
        enabled = query(source, "SELECT enabled FROM sim_control WHERE control_id=1")
        if not enabled or enabled[0][0] != 0:
            raise CdcReadinessError("CDC_SIMULATION_NOT_STOPPED")
        stage = "EMPTY_SOURCE"
        for name in ["customers","products","orders","order_items","payments","financial_transactions"]:
            # Table names are fixed, never user-controlled.
            if query(source, f"SELECT 1 FROM {name} LIMIT 1"):
                raise CdcReadinessError("CDC_SOURCE_NOT_EMPTY")
        stage = "BINLOG_PREFLIGHT"
        file, pos = preflight()
        stage = "SINK_CHECKPOINT"
        if query(sink, "SELECT 1 FROM cdc_checkpoint WHERE consumer_name=%s",(CONSUMER,)):
            raise CdcReadinessError("CDC_CHECKPOINT_ALREADY_EXISTS")
        stage = "CHECKPOINT_WRITE"
        write(sink, "INSERT INTO cdc_checkpoint(consumer_name,log_file,log_pos,updated_at) VALUES(%s,%s,%s,%s)",
              (CONSUMER,file,pos,utcnow()))
        sink.commit()
        return {"status":"BOOTSTRAPPED_EMPTY_SOURCE","binlog_file":file,"position":pos}
    except Exception as exc:
        if sink is not None:
            try:
                sink.rollback()
            except Exception:
                pass
        # Only whitelisted stages are emitted; never include the original
        # RuntimeError message, SQL query, username or connection settings.
        if isinstance(exc, RuntimeError) and not isinstance(exc, CdcReadinessError):
            raise CdcBootstrapStageError(stage) from None
        raise
    finally:
        if sink is not None:
            sink.close()
        if source is not None:
            source.close()


def _silver_entity(db, table, pk, payload, deleted, key, now):
    write(db, """INSERT INTO silver_entity_state(entity,entity_id,payload,is_deleted,last_event_key,updated_at)
         VALUES(%s,%s,%s,%s,%s,%s)
         ON DUPLICATE KEY UPDATE payload=VALUES(payload),is_deleted=VALUES(is_deleted),
         last_event_key=VALUES(last_event_key),updated_at=VALUES(updated_at)""",
        (table,pk,encode(payload) if payload is not None else None, int(deleted),key,now))


def _order_day(db, order_id):
    rows = query(db,"SELECT DATE(ordered_at),customer_id FROM silver_orders WHERE order_id=%s",(order_id,))
    return rows[0] if rows else (None,None)


def _recompute_day(db, day, now):
    if day is None:return
    # Use sargable day ranges; never aggregate every payment in the source.
    # The original unfiltered payments GROUP BY scanned the entire Silver table
    # for each touched day, defeating incremental processing on a micro RDS.
    start = day
    count, cancellations, gross = query(db,"""SELECT COUNT(*),COALESCE(SUM(status='CANCELLED'),0),
         COALESCE(SUM(CASE WHEN status<>'CANCELLED' THEN total ELSE 0 END),0)
         FROM silver_orders WHERE ordered_at >= %s
         AND ordered_at < DATE_ADD(%s, INTERVAL 1 DAY)
         AND is_deleted=FALSE""", (start,start))[0]
    net = query(db,"""SELECT COALESCE(SUM(CASE p.status
           WHEN 'CAPTURED' THEN p.amount WHEN 'REFUNDED' THEN -p.amount ELSE 0 END),0)
         FROM silver_orders o JOIN silver_payments p ON p.order_id=o.order_id
         WHERE o.ordered_at >= %s AND o.ordered_at < DATE_ADD(%s, INTERVAL 1 DAY)
           AND o.is_deleted=FALSE AND o.status<>'CANCELLED'
           AND p.is_deleted=FALSE""", (start,start))[0][0]
    write(db,"""INSERT INTO gold_daily_sales(order_day,order_count,cancelled_count,gross_sales,net_payments,recorded_at)
        VALUES(%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE
        order_count=VALUES(order_count),cancelled_count=VALUES(cancelled_count),
        gross_sales=VALUES(gross_sales),net_payments=VALUES(net_payments),recorded_at=VALUES(recorded_at)""",
        (day,count,cancellations,gross,net,now))


def _recompute_transaction_day(db,day,now):
    if day is None:return
    count, net = query(db,"""SELECT COUNT(*),COALESCE(SUM(CASE WHEN transaction_type='REFUND'
       THEN -amount ELSE amount END),0) FROM silver_transactions
       WHERE occurred_at >= %s AND occurred_at < DATE_ADD(%s, INTERVAL 1 DAY)
       AND is_deleted=FALSE""",(day,day))[0]
    write(db,"""INSERT INTO gold_daily_transactions(transaction_day,transaction_count,net_amount,recorded_at)
         VALUES(%s,%s,%s,%s) ON DUPLICATE KEY UPDATE transaction_count=VALUES(transaction_count),
         net_amount=VALUES(net_amount),recorded_at=VALUES(recorded_at)""",(day,count,net,now))


def _recompute_customer(db, cid, now):
    if cid is None:return
    count, total = query(db,"""SELECT COUNT(*), COALESCE(SUM(CASE WHEN status<>'CANCELLED' THEN total ELSE 0 END),0)
          FROM silver_orders WHERE customer_id=%s AND is_deleted=FALSE""",(cid,))[0]
    write(db,"""INSERT INTO gold_customer_activity(customer_id,order_count,lifetime_order_value,recorded_at)
         VALUES(%s,%s,%s,%s) ON DUPLICATE KEY UPDATE order_count=VALUES(order_count),
         lifetime_order_value=VALUES(lifetime_order_value),recorded_at=VALUES(recorded_at)""",
         (cid,count,total,now))


def apply_change(db, table, op, old, new, key, file, position, row_idx, event_at):
    """Called inside the same transaction as checkpoint advancement."""
    table = allowed_table(table)
    if op not in {"INSERT","UPDATE","DELETE"}:
        raise ValueError("Unsupported binlog operation")
    payload = new if new is not None else old
    if not isinstance(payload, dict) or "id" not in payload:
        raise ValueError("CDC must include the primary key; check binlog_row_image")
    pk = int(payload["id"])
    now = utcnow()
    inserted = write(db,"""INSERT IGNORE INTO bronze_changes
        (event_key,source_file,source_pos,row_index,entity,operation,entity_id,
        old_payload,new_payload,event_at,received_at)
        VALUES(%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
        (key,file,position,row_idx,table,op,pk,
         encode(old) if old is not None else None,
         encode(new) if new is not None else None,event_at,now))
    if inserted == 0:return False
    deleted = op == "DELETE" or bool((new or {}).get("is_deleted",False))
    _silver_entity(db,table,pk,new,deleted,key,now)
    days, customers = set(), set()
    if table == "orders":
        old_day, old_customer = _order_day(db, pk)
        if old_day:days.add(old_day)
        if old_customer:customers.add(old_customer)
        if op == "DELETE":
            write(db,"UPDATE silver_orders SET is_deleted=TRUE WHERE order_id=%s",(pk,))
        else:
            for field in ("customer_id","total","status","ordered_at"):
                if field not in new:raise ValueError("Incomplete order row image")
            if Decimal(str(new["total"])) < 0:raise ValueError("Negative order total")
            write(db,"""INSERT INTO silver_orders(order_id,customer_id,total,status,ordered_at,is_deleted)
                  VALUES(%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE
                  customer_id=VALUES(customer_id),total=VALUES(total),status=VALUES(status),
                  ordered_at=VALUES(ordered_at),is_deleted=VALUES(is_deleted)""",
                (pk,new["customer_id"],new["total"],new["status"],new["ordered_at"],int(deleted)))
            day,cid = _order_day(db,pk)
            if day:days.add(day)
            if cid:customers.add(cid)
    elif table == "payments":
        previous = query(db,"SELECT order_id FROM silver_payments WHERE payment_id=%s",(pk,))
        order_ids = {previous[0][0]} if previous else set()
        if op == "DELETE":
            write(db,"UPDATE silver_payments SET is_deleted=TRUE WHERE payment_id=%s",(pk,))
        else:
            for field in ("order_id","amount","status"):
                if field not in new:raise ValueError("Incomplete payment row image")
            if Decimal(str(new["amount"])) < 0:raise ValueError("Negative payment")
            write(db,"""INSERT INTO silver_payments(payment_id,order_id,amount,status,is_deleted)
                    VALUES(%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE
                    order_id=VALUES(order_id),amount=VALUES(amount),
                    status=VALUES(status),is_deleted=VALUES(is_deleted)""",
                (pk,new["order_id"],new["amount"],new["status"],int(deleted)))
            order_ids.add(int(new["order_id"]))
        for order_id in order_ids:
            day,cid = _order_day(db,order_id)
            if day:days.add(day)
            if cid:customers.add(cid)
    elif table == "financial_transactions":
        old_date = query(db,"SELECT DATE(occurred_at) FROM silver_transactions WHERE transaction_id=%s",(pk,))
        impacted = set([old_date[0][0]]) if old_date else set()
        if op == "DELETE":
            write(db,"UPDATE silver_transactions SET is_deleted=TRUE WHERE transaction_id=%s",(pk,))
        else:
            for field in ("payment_id","transaction_type","amount","occurred_at"):
                if field not in new:raise ValueError("Incomplete financial transaction row image")
            if Decimal(str(new["amount"]))<0:raise ValueError("Negative transaction amount")
            write(db,"""INSERT INTO silver_transactions(transaction_id,payment_id,transaction_type,amount,occurred_at,is_deleted)
                VALUES(%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE payment_id=VALUES(payment_id),
                transaction_type=VALUES(transaction_type),amount=VALUES(amount),
                occurred_at=VALUES(occurred_at),is_deleted=VALUES(is_deleted)""",
                (pk,new["payment_id"],new["transaction_type"],new["amount"],new["occurred_at"],int(deleted)))
            impacted.add(query(db,"SELECT DATE(occurred_at) FROM silver_transactions WHERE transaction_id=%s",(pk,))[0][0])
        for day in impacted:_recompute_transaction_day(db,day,now)
    for day in days:_recompute_day(db,day,now)
    for cid in customers:_recompute_customer(db,cid,now)
    return True


def run(max_events=None, max_seconds=None):
    if os.environ.get("SIM_CDC_ENABLED") != "true":
        raise RuntimeError("CDC consumption is disabled")
    from pymysqlreplication import BinLogStreamReader
    from pymysqlreplication.row_event import WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent
    max_events = positive_int(max_events or os.environ.get("SIM_CDC_MAX_EVENTS",200),"CDC events",1000)
    max_seconds = positive_int(max_seconds or os.environ.get("SIM_CDC_MAX_SECONDS",20),"CDC deadline",240)
    sink = connect("cdc")
    locked = False
    stream = None
    started = time.monotonic()
    row_count = 0
    run_id = None
    try:
        locked = query(sink,"SELECT GET_LOCK(%s,0)",(LOCK_NAME,))[0][0] == 1
        if not locked:raise RuntimeError("CDC worker already running")
        point = query(sink,"SELECT log_file,log_pos FROM cdc_checkpoint WHERE consumer_name=%s",(CONSUMER,))
        if not point:raise RuntimeError("No checkpoint. Bootstrap against an EMPTY stopped simulation first")
        file,pos = point[0]
        write(sink,"INSERT INTO cdc_worker_runs(started_at,state) VALUES(%s,'RUNNING')",(utcnow(),))
        run_id = query(sink,"SELECT LAST_INSERT_ID()")[0][0]
        sink.commit()
        preflight()
        config = connection_config("replica")
        # Stable unique server_id per independent binlog reader; never reuse a replica server-id.
        server_id = positive_int(os.environ.get("SIM_CDC_SERVER_ID","24124"),"replica server id",4294967295)
        stream = BinLogStreamReader(connection_settings=config,server_id=server_id,
            only_schemas=["fixer_sim"],only_tables=["customers","products","orders","order_items","payments","financial_transactions"],
            only_events=[WriteRowsEvent,UpdateRowsEvent,DeleteRowsEvent],
            blocking=False,resume_stream=True,log_file=file,log_pos=int(pos),
            freeze_schema=True,fail_on_table_metadata_unavailable=True)
        for evt in stream:
            if time.monotonic()-started > max_seconds or row_count >= max_events:break
            if evt.schema != "fixer_sim":raise RuntimeError("Unexpected CDC schema")
            table = allowed_table(evt.table)
            op = "INSERT" if isinstance(evt,WriteRowsEvent) else "UPDATE" if isinstance(evt,UpdateRowsEvent) else "DELETE"
            next_file = stream.log_file
            next_pos = int(evt.packet.log_pos)
            event_at = datetime.fromtimestamp(evt.timestamp, tz=timezone.utc).replace(tzinfo=None)
            # Consume the entire row event as one transaction or do not advance its checkpoint.
            if row_count+len(evt.rows)>max_events:break
            try:
                for row_idx,row in enumerate(evt.rows):
                    old = row.get("before_values") if op=="UPDATE" else row.get("values") if op=="DELETE" else None
                    new = row.get("after_values") if op=="UPDATE" else row.get("values") if op=="INSERT" else None
                    key = event_id(next_file,next_pos,row_idx)
                    if apply_change(sink,table,op,old,new,key,next_file,next_pos,row_idx,event_at):row_count+=1
                write(sink,"UPDATE cdc_checkpoint SET log_file=%s,log_pos=%s,updated_at=%s WHERE consumer_name=%s",
                      (next_file,next_pos,utcnow(),CONSUMER))
                sink.commit()
            except Exception:
                sink.rollback()
                raise
        write(sink,"UPDATE cdc_worker_runs SET finished_at=%s,state='SUCCEEDED',events_processed=%s WHERE id=%s",
              (utcnow(),row_count,run_id))
        sink.commit()
        return {"status":"SUCCEEDED","events_processed":row_count,"duration_seconds":round(time.monotonic()-started,3)}
    except Exception as exc:
        sink.rollback()
        if run_id:
            try:
                write(sink,"UPDATE cdc_worker_runs SET finished_at=%s,state='FAILED',events_processed=%s,error_type=%s WHERE id=%s",
                     (utcnow(),row_count,redacted_error(exc),run_id))
                sink.commit()
            except Exception:sink.rollback()
        raise
    finally:
        if stream is not None:stream.close()
        if locked:
            try:query(sink,"SELECT RELEASE_LOCK(%s)",(LOCK_NAME,))
            except Exception:pass
        sink.close()


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv)>1 else "consume"
    try:
        if action == "bootstrap":print(json.dumps(bootstrap_empty_source()))
        elif action == "preflight":print(json.dumps({"status":"OK","binlog":preflight()}))
        elif action == "consume":print(json.dumps(run()))
        else:raise ValueError("Unknown CDC action")
    except Exception as exc:
        # Never print arbitrary exception text: database driver failures can
        # contain hosts, SQL, account names or other sensitive details.
        payload = {"status":"FAILED","error_type":redacted_error(exc)}
        if isinstance(exc, CdcReadinessError):
            payload["error_code"] = exc.code
        elif isinstance(exc, CdcBootstrapStageError):
            payload["error_code"] = "CDC_BOOTSTRAP_STAGE_FAILED"
            payload["stage"] = exc.stage
        elif os.environ.get("SIM_ENV") == "local" and getattr(exc, "args", ()) and isinstance(exc.args[0], int):
            # MySQL integer errno is non-sensitive and helps isolate local
            # database permissions/version errors without exposing SQL text.
            payload["mysql_errno"] = exc.args[0]
        print(json.dumps(payload),file=sys.stderr)
        sys.exit(1)
