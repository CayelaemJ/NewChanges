"""Pure, independently unit-testable simulation and CDC helpers."""
import hashlib
import json
import random
from datetime import datetime, timedelta, timezone
from decimal import Decimal

OPERATIONS = {"INSERT", "UPDATE", "DELETE", "UPSERT", "CORRECTION", "LATE", "BULK", "ROLLBACK", "DUPLICATE"}
ENTITIES = {"customers", "products", "orders", "order_items", "payments", "financial_transactions"}


def event_id(log_file, log_pos, row_index):
    if not log_file or int(log_pos) < 0 or int(row_index) < 0:
        raise ValueError("Invalid binlog event coordinate")
    return hashlib.sha256(f"{log_file}:{log_pos}:{row_index}".encode()).hexdigest()


def jsonable(value):
    if isinstance(value, (datetime,)):
        return value.isoformat(timespec="microseconds")
    if isinstance(value, Decimal):
        return str(value)
    if isinstance(value, (bytes, bytearray)):
        return value.hex()
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    return value


def encode(value):
    return json.dumps(jsonable(value), separators=(",", ":"), sort_keys=True)


def schedule_counts(seed, max_orders=30, now=None):
    """Predictable repeatable traffic with weekday/weekend and intra-day variance."""
    now = now or datetime.now(timezone.utc)
    rng = random.Random(f"{seed}:{now.date()}:{now.hour}")
    weekday_multiplier = .65 if now.weekday() >= 5 else 1.0
    hour_multiplier = 1.35 if 8 <= now.hour < 18 else .45
    orders = min(max_orders, max(1, round(max_orders * weekday_multiplier * hour_multiplier * (.65 + rng.random()*.35))))
    return {"orders": orders, "customers": max(1, orders//4), "updates": max(1, orders//3),
            "corrections": max(1, orders//10), "late": max(1, orders//8)}


def choose_historical_time(rng, anchor, max_lag_days=14):
    return anchor - timedelta(days=rng.randint(1, max_lag_days), hours=rng.randint(0, 23))


def allowed_table(table):
    if table not in ENTITIES:
        raise ValueError("CDC refuses non-simulation table")
    return table
