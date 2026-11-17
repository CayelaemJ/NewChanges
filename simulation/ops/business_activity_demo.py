"""Repeatable, local-only business activity demo for real MySQL binlog CDC.

Runs EXISTING validated synthetic business rules, then consumes the resulting
row-binlog events and compares source activity with Gold analytics.
NOT a production RDS tool or a direct The Fixer dashboard connection.
"""
import argparse
import json
import os
import re
import time

from runtime.common import connect
from runtime.cdc import run as consume_cdc, query
from runtime.simulator import run as generate


def require_disposable_environment():
    required = {
        "SIM_ENV": "local",
        "RUN_LOCAL_MYSQL_TESTS": "yes",
        "SIMULATION_WRITES_APPROVED": "YES_ISOLATED_SYNTHETIC_ONLY",
        "SIM_CDC_ENABLED": "true",
        "SIM_DB_HOST": "mysql",
        "SIM_CDC_HOST": "mysql",
        "SIM_REPL_HOST": "mysql",
        "SIM_DB_DATABASE": "fixer_sim",
        "SIM_CDC_DATABASE": "fixer_sim_analytics",
        "SIM_REPL_DATABASE": "fixer_sim",
    }
    if any(os.environ.get(key) != value for key, value in required.items()):
        raise RuntimeError("LOCAL_DISPOSABLE_DEMO_ONLY")


def metrics():
    source = connect("writer")
    sink = connect("cdc")
    try:
        source.rollback()
        sink.rollback()
        return {
            "source_orders": int(query(source, "SELECT COUNT(*) FROM orders")[0][0]),
            "source_payments": int(query(source, "SELECT COUNT(*) FROM payments")[0][0]),
            "source_transactions": int(query(source, "SELECT COUNT(*) FROM financial_transactions")[0][0]),
            "cdc_changes": int(query(sink, "SELECT COUNT(*) FROM bronze_changes")[0][0]),
            "gold_order_count": int(query(sink, "SELECT COALESCE(SUM(order_count),0) FROM gold_daily_sales")[0][0]),
            "gold_gross_sales": str(query(sink, "SELECT COALESCE(SUM(gross_sales),0) FROM gold_daily_sales")[0][0]),
            "gold_net_payments": str(query(sink, "SELECT COALESCE(SUM(net_payments),0) FROM gold_daily_sales")[0][0]),
        }
    finally:
        source.rollback()
        sink.rollback()
        source.close()
        sink.close()


def execute(cycles=3, interval_seconds=2, orders_per_cycle=6, demo_id="demo"):
    require_disposable_environment()
    if not isinstance(cycles, int) or not 1 <= cycles <= 10:
        raise ValueError("cycles must be 1..10")
    if not isinstance(interval_seconds, int) or not 0 <= interval_seconds <= 30:
        raise ValueError("interval_seconds must be 0..30")
    if not isinstance(orders_per_cycle, int) or not 1 <= orders_per_cycle <= 20:
        raise ValueError("orders_per_cycle must be 1..20")
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,24}", demo_id):
        raise ValueError("demo_id must contain only safe identifier characters")

    db = connect("writer")
    try:
        # Only the temporary docker fixture has this switch; always restore OFF.
        db.rollback()
        with db.cursor() as cursor:
            cursor.execute("UPDATE sim_control SET enabled=TRUE WHERE control_id=1")
        db.commit()
    finally:
        db.close()

    try:
        previous = metrics()
        print(json.dumps({"kind": "baseline", "values": previous}), flush=True)
        for cycle in range(1, cycles + 1):
            key = f"demo:{demo_id}:cycle:{cycle}"
            event = generate(run_key=key, seed=demo_id, max_orders=orders_per_cycle)
            # Consume real committed MySQL row binlog, NOT updated_at polling.
            cdc = consume_cdc(max_events=1000, max_seconds=30)
            current = metrics()
            change = {
                name: current[name] - previous[name]
                for name in ("source_orders", "source_payments", "source_transactions", "cdc_changes", "gold_order_count")
            }
            print(json.dumps({
                "kind": "business_cycle",
                "cycle": cycle,
                "scenario": "customers -> orders -> payments -> financial transactions; status/correction/delete/rollback",
                "generator_status": event["status"],
                "generated": event["statistics"],
                "cdc_status": cdc["status"],
                "cdc_events_processed": cdc["events_processed"],
                "changes": change,
                "reporting": current,
                "reporting_source": "local MySQL Gold; NOT The Fixer production dashboard",
            }), flush=True)
            if cycle < cycles:
                time.sleep(interval_seconds)
            previous = current
    finally:
        db = connect("writer")
        try:
            with db.cursor() as cursor:
                cursor.execute("UPDATE sim_control SET enabled=FALSE WHERE control_id=1")
            db.commit()
        finally:
            db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--cycles", type=int, default=3)
    parser.add_argument("--interval-seconds", type=int, default=2)
    parser.add_argument("--orders-per-cycle", type=int, default=6)
    parser.add_argument("--demo-id", default="demo")
    args = parser.parse_args()
    try:
        execute(args.cycles, args.interval_seconds, args.orders_per_cycle, args.demo_id)
    except Exception:
        # Never dump MySQL exception strings, credentials, or raw business rows.
        print(json.dumps({"kind": "demo_error", "code": "DEMO_FAILED_CHECK_LOGS_SAFELY"}), flush=True)
        raise SystemExit(1)
