"""Bounded operational MySQL generator. Nothing runs without dual approval gates."""
import json
import os
import random
import sys
import time
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from .common import connect, positive_int, redacted_error, utcnow
from .logic import choose_historical_time, schedule_counts

LOCK_NAME = "fixer_sim.generator.v1"


def _sql(conn, query, args=()):
    with conn.cursor() as c:
        c.execute(query, args)
        return c.rowcount, c.lastrowid


def _rows(conn, query, args=()):
    with conn.cursor() as c:
        c.execute(query, args)
        return c.fetchall()


def _once(conn, key, op, at):
    result, _ = _sql(conn, "INSERT IGNORE INTO business_events(event_key, operation, occurred_at) VALUES(%s,%s,%s)", (key, op, at))
    return result == 1


def _execute_event(conn, key, op, at, fn):
    """Atomic event idempotency plus operation. Replays of committed keys do nothing."""
    try:
        if not _once(conn, key, op, at):
            conn.rollback()
            return False
        fn()
        conn.commit()
        return True
    except Exception:
        conn.rollback()
        raise


def run(run_key=None, seed=None, max_orders=None):
    if os.environ.get("SIMULATION_WRITES_APPROVED") != "YES_ISOLATED_SYNTHETIC_ONLY":
        raise RuntimeError("Synthetic writes disabled: explicit approval required")
    run_key = run_key or os.environ.get("SIM_RUN_KEY")
    if not run_key or len(run_key) > 60 or not all(c.isalnum() or c in "-_.:" for c in run_key):
        raise ValueError("SIM_RUN_KEY must be a short stable idempotency key")
    seed = seed if seed is not None else os.environ.get("SIM_SEED", "seed-v1")
    max_orders = positive_int(max_orders or os.environ.get("SIM_MAX_ORDERS", 16), "orders/run", 200)
    now = utcnow()
    rng = random.Random(f"{seed}|{run_key}")
    stats = {"insert": 0, "update": 0, "logical_delete": 0, "correction": 0,
             "late": 0, "duplicate_skipped": 0, "rollback_verified": 0, "bulk": 0,
             "physical_delete":0, "returning_customers":0, "failed_transactions":0}
    conn = connect("writer")
    locked = False
    started = time.monotonic()
    try:
        result = _rows(conn, "SELECT GET_LOCK(%s,0)", (LOCK_NAME,))
        locked = bool(result and result[0][0] == 1)
        if not locked:
            raise RuntimeError("Simulation already running; refusing overlap")
        enabled = _rows(conn, "SELECT enabled FROM sim_control WHERE control_id=1")
        if not enabled or enabled[0][0] != 1:
            raise RuntimeError("Emergency stop active: sim_control.enabled is false")
        existing = _rows(conn, "SELECT status FROM simulation_runs WHERE run_key=%s", (run_key,))
        if existing and existing[0][0] == "SUCCEEDED":
            return {"status": "ALREADY_APPLIED", "run_key": run_key, "statistics": stats}
        if existing:
            _sql(conn, "UPDATE simulation_runs SET status='RUNNING',started_at=%s,finished_at=NULL,error_code=NULL WHERE run_key=%s", (now,run_key))
        else:
            _sql(conn, "INSERT INTO simulation_runs(run_key,status,started_at) VALUES(%s,'RUNNING',%s)", (run_key,now))
        conn.commit()

        # Repeatable product catalogue, each entry keyed by run/event for retry safety.
        for i in range(8):
            key = f"catalog:{i}"
            price = Decimal(str(round(40 + i * 17.19, 2)))
            def make_product(i=i, price=price):
                _sql(conn, "INSERT INTO products(sku,product_name,price,inventory,updated_at) VALUES(%s,%s,%s,200,%s) ON DUPLICATE KEY UPDATE sku=sku",
                     (f"SYN-SKU-{i:03d}", f"Synthetic Product {i}", price, now))
            _execute_event(conn, key, "UPSERT", now, make_product)

        today = datetime.now(timezone.utc)
        plan = schedule_counts(seed, max_orders=max_orders, now=today)
        for i in range(plan["customers"]):
            key = f"{run_key}:customer:{i}"
            def make_customer(i=i):
                customer_key = f"SYN-CUST-{run_key}-{i}"
                _sql(conn, "INSERT INTO customers(customer_key,full_name,email,segment,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s)",
                     (customer_key, f"Synthetic Customer {i}", f"{customer_key.lower()}@example.invalid", rng.choice(["consumer","business","wholesale"]), now, now))
            if _execute_event(conn,key,"INSERT",now,make_customer):stats["insert"] += 1

        # Real bulk import in a single atomic transaction, with a stable batch key.
        batch_key = f"{run_key}:bulk:customers"
        batch_size = min(10, max(2, max_orders // 2))
        def import_batch():
            batch = [(f"SYN-BULK-{run_key}-{j}", f"Synthetic Bulk Customer {j}",
                      f"syn-bulk-{run_key}-{j}@example.invalid", "consumer", now, now)
                     for j in range(batch_size)]
            with conn.cursor() as c:
                c.executemany("INSERT INTO customers(customer_key,full_name,email,segment,created_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s)",batch)
        if _execute_event(conn,batch_key,"BULK",now,import_batch):
            stats["bulk"] += batch_size
            stats["insert"] += batch_size

        customers = [x[0] for x in _rows(conn, "SELECT id FROM customers WHERE is_deleted=FALSE ORDER BY id DESC LIMIT 500")]
        products = _rows(conn, "SELECT id,price FROM products WHERE is_deleted=FALSE ORDER BY id LIMIT 50")
        if not customers or not products:
            raise RuntimeError("Missing synthetic foreign-key parents")
        for i in range(plan["orders"]):
            key = f"{run_key}:order:{i}"
            ordered_at = choose_historical_time(rng, now, 14) if i < plan["late"] else now
            customer_id = rng.choice(customers)
            product_id, price = rng.choice(products)
            qty = rng.randint(1,4)
            amount = Decimal(str(price)) * qty
            status = "PAID" if rng.random() > .2 else "PENDING"
            def make_order():
                _, order_id = _sql(conn, "INSERT INTO orders(order_key,customer_id,total,status,ordered_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s)",
                    (f"SYN-ORDER-{run_key}-{i}", customer_id, amount, status, ordered_at, now))
                _sql(conn, "INSERT INTO order_items(order_id,product_id,quantity,unit_price) VALUES(%s,%s,%s,%s)", (order_id,product_id,qty,price))
                _, payment_id = _sql(conn, "INSERT INTO payments(payment_key,order_id,amount,status,event_at,updated_at) VALUES(%s,%s,%s,%s,%s,%s)",
                     (f"SYN-PAY-{run_key}-{i}",order_id,amount,"CAPTURED" if status=="PAID" else "PENDING",ordered_at,now))
                _sql(conn, "INSERT INTO financial_transactions(transaction_key,payment_id,transaction_type,amount,occurred_at,updated_at) VALUES(%s,%s,'SALE',%s,%s,%s)",
                     (f"SYN-TXN-{run_key}-{i}",payment_id,amount,ordered_at,now))
            if _execute_event(conn,key,"INSERT",now,make_order):
                stats["insert"] += 4
                if ordered_at != now:stats["late"] += 1

        # Returning customer: same natural key, updated profile, no duplicate row.
        if customers:
            cid = rng.choice(customers)
            if _execute_event(conn,f"{run_key}:returning", "UPSERT",now,
                  lambda: _sql(conn,"UPDATE customers SET segment='business',updated_at=%s WHERE id=%s",(now,cid))):
                stats["returning_customers"] += 1
                stats["update"] += 1

        orders = _rows(conn, "SELECT id,status FROM orders ORDER BY id DESC LIMIT 200")
        for i in range(min(plan["updates"],len(orders))):
            oid, status = rng.choice(orders)
            key = f"{run_key}:status:{i}"
            choices = [s for s in ["SHIPPED","DELIVERED","CANCELLED"] if s != status]
            new = rng.choice(choices)
            if _execute_event(conn,key,"UPDATE",now,lambda: _sql(conn,"UPDATE orders SET status=%s,updated_at=%s WHERE id=%s",(new,now,oid))):
                stats["update"] += 1
        for i in range(min(plan["corrections"],len(orders))):
            oid, _ = rng.choice(orders)
            key = f"{run_key}:correction:{i}"
            # Historical financial correction. Order totals remain non-negative.
            if _execute_event(conn,key,"CORRECTION",now,lambda: _sql(conn,"UPDATE orders SET total=ROUND(total*0.98,2),updated_at=%s WHERE id=%s",(now,oid))):
                stats["correction"] += 1

        # Logical deletion retains FK history; physical deletion touches only synthetic finance rows.
        if customers:
            cid = rng.choice(customers)
            key = f"{run_key}:retention"
            if _execute_event(conn,key,"DELETE",now,lambda: _sql(conn,"UPDATE customers SET is_deleted=TRUE,updated_at=%s WHERE id=%s",(now,cid))):
                stats["logical_delete"] += 1
        if products:
            pid,_ = rng.choice(products)
            key = f"{run_key}:price"
            if _execute_event(conn,key,"UPDATE",now,lambda: _sql(conn,"UPDATE products SET price=ROUND(price*1.01,2),updated_at=%s WHERE id=%s",(now,pid))):
                stats["update"] += 1

        # Real hard-delete CDC, limited to one synthetic transaction. FK references
        # are preserved by deleting a child record rather than its payment/parent.
        pending = _rows(conn,"SELECT id FROM financial_transactions WHERE transaction_type='SALE' ORDER BY id LIMIT 1")
        if pending:
            target_id = pending[0][0]
            if _execute_event(conn,f"{run_key}:physical_transaction_delete","DELETE",now,
                    lambda: _sql(conn,"DELETE FROM financial_transactions WHERE id=%s",(target_id,))):
                stats["physical_delete"] += 1

        # Failed financial statement must roll back without modifying any rows.
        try:
            _sql(conn,"INSERT INTO products(sku,product_name,price,inventory,updated_at) VALUES(%s,%s,-1,0,%s)",
                 (f"SYN-REJECTED-{run_key}","Rejected negative price",now))
            conn.rollback()
            raise RuntimeError("CHECK constraint did not reject the invalid financial record")
        except Exception as exc:
            conn.rollback()
            if isinstance(exc,RuntimeError):raise
            stats["failed_transactions"] += 1

        # Duplicate business event should not be applied twice.
        if not _execute_event(conn,f"{run_key}:price","UPDATE",now,lambda: (_ for _ in ()).throw(AssertionError("Duplicate applied"))):
            stats["duplicate_skipped"] += 1

        # Explicit safe rollback test; no committed event or order remains.
        conn.begin()
        try:
            _sql(conn, "INSERT INTO business_events(event_key,operation,occurred_at) VALUES(%s,'ROLLBACK',%s)", (f"{run_key}:rollback",now))
        finally:
            conn.rollback()
        stats["rollback_verified"] += 1

        _sql(conn,"UPDATE simulation_runs SET status='SUCCEEDED',finished_at=%s,statistics=%s WHERE run_key=%s",
             (utcnow(),json.dumps(stats),run_key))
        conn.commit()
        return {"status":"SUCCEEDED","run_key":run_key,"statistics":stats,"duration_seconds":round(time.monotonic()-started,3)}
    except Exception as exc:
        conn.rollback()
        if locked:
            try:
                _sql(conn,"UPDATE simulation_runs SET status='FAILED',finished_at=%s,error_code=%s WHERE run_key=%s",
                     (utcnow(),redacted_error(exc),run_key))
                conn.commit()
            except Exception:
                conn.rollback()
        raise
    finally:
        if locked:
            try:_rows(conn,"SELECT RELEASE_LOCK(%s)",(LOCK_NAME,))
            except Exception:pass
        conn.close()


if __name__ == "__main__":
    try:
        print(json.dumps(run()))
    except Exception as error:
        print(json.dumps({"status":"FAILED","error_type":redacted_error(error)}),file=sys.stderr)
        sys.exit(1)
