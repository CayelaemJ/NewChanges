"""All-ten-feed local MySQL CDC scenario: INSERT, UPDATE, DELETE per feed.

This is a disposable Docker-only contract fixture. The eight fixture_state
tables do not model real reporting views or business calculations.
"""
import argparse
import hashlib
import json
import os
import re
import time
from decimal import Decimal

from runtime.common import connect, connection_config
from runtime.ingest_stage_contract import FEED_TABLES, SnapshotHandoff
from runtime.ingest_stage_sink import bootstrap_local_sink
from runtime.ingest_stage_stream import run_local_binlog

CONSUMER = "ten-feed-demo-v1"
HMAC_SECRET = b"local-only-ten-feed-demo-hmac-key-not-for-production"
FEEDS = tuple(sorted(FEED_TABLES))
STATIC_SQL = {
    "employers": {
        "insert": "INSERT INTO employers (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
        "update": "UPDATE employers SET fixture_state=%s WHERE _ingest_id=%s",
        "delete": "DELETE FROM employers WHERE _ingest_id=%s",
    },
    "workforce_snapshots": {
        "insert": "INSERT INTO workforce_snapshots (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
        "update": "UPDATE workforce_snapshots SET fixture_state=%s WHERE _ingest_id=%s",
        "delete": "DELETE FROM workforce_snapshots WHERE _ingest_id=%s",
    },
    "employees": {
        "insert": "INSERT INTO employees (_ingest_id,employee_status,source_updated_at) VALUES(%s,%s,%s)",
        "update": "UPDATE employees SET employee_status=%s WHERE _ingest_id=%s",
        "delete": "DELETE FROM employees WHERE _ingest_id=%s",
    },
    "platform_users": {
        "insert": "INSERT INTO platform_users (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
        "update": "UPDATE platform_users SET fixture_state=%s WHERE _ingest_id=%s",
        "delete": "DELETE FROM platform_users WHERE _ingest_id=%s",
    },
    "journeys": {
        "insert": "INSERT INTO journeys (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
        "update": "UPDATE journeys SET fixture_state=%s WHERE _ingest_id=%s",
        "delete": "DELETE FROM journeys WHERE _ingest_id=%s",
    },
    "debt_accounts": {
        "insert": "INSERT INTO debt_accounts (_ingest_id,debt_balance,source_updated_at) VALUES(%s,%s,%s)",
        "update": "UPDATE debt_accounts SET debt_balance=%s WHERE _ingest_id=%s",
        "delete": "DELETE FROM debt_accounts WHERE _ingest_id=%s",
    },
    "policies": {
        "insert": "INSERT INTO policies (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
        "update": "UPDATE policies SET fixture_state=%s WHERE _ingest_id=%s",
        "delete": "DELETE FROM policies WHERE _ingest_id=%s",
    },
    "ratings": {
        "insert": "INSERT INTO ratings (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
        "update": "UPDATE ratings SET fixture_state=%s WHERE _ingest_id=%s",
        "delete": "DELETE FROM ratings WHERE _ingest_id=%s",
    },
    "referrals": {
        "insert": "INSERT INTO referrals (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
        "update": "UPDATE referrals SET fixture_state=%s WHERE _ingest_id=%s",
        "delete": "DELETE FROM referrals WHERE _ingest_id=%s",
    },
    "salary_advances": {
        "insert": "INSERT INTO salary_advances (_ingest_id,fixture_state,source_updated_at) VALUES(%s,%s,%s)",
        "update": "UPDATE salary_advances SET fixture_state=%s WHERE _ingest_id=%s",
        "delete": "DELETE FROM salary_advances WHERE _ingest_id=%s",
    },
}
EVENTS = ("insert", "update", "delete")


def require_isolation():
    expected = {
        "SIM_ENV": "local", "RUN_LOCAL_MYSQL_TESTS": "yes",
        "SIMULATION_WRITES_APPROVED": "YES_ISOLATED_SYNTHETIC_ONLY",
        "SIM_DB_HOST": "mysql", "SIM_REPL_HOST": "mysql",
        "SIM_CDC_HOST": "mysql", "SIM_DB_DATABASE": "fixer_sim",
        "SIM_REPL_DATABASE": "fixer_sim",
        "SIM_CDC_DATABASE": "fixer_sim_analytics",
    }
    if any(os.environ.get(key) != value for key, value in expected.items()):
        raise RuntimeError("TEN_FEED_DEMO_DISPOSABLE_ONLY")
    if set(STATIC_SQL) != FEED_TABLES:
        raise RuntimeError("TEN_FEED_FIXTURE_MISMATCH")


def source_connection():
    import pymysql
    config = connection_config("writer")
    if config["host"] != "mysql":
        raise RuntimeError("TEN_FEED_DEMO_DISPOSABLE_ONLY")
    config["database"] = "ingest_stage"
    return pymysql.connect(**config)


def read_counts(sink):
    sink.rollback()
    with sink.cursor() as cursor:
        cursor.execute("""SELECT feed, operation, COUNT(*) FROM
            fixer_ingest_cdc.ingest_change_markers
            WHERE consumer_name=%s GROUP BY feed, operation""", (CONSUMER,))
        markers = {(feed, op): int(n) for feed, op, n in cursor.fetchall()}
        cursor.execute("""SELECT feed, generation FROM
            fixer_ingest_cdc.ingest_feed_notifications
            WHERE consumer_name=%s""", (CONSUMER,))
        generations = dict(cursor.fetchall())
    sink.rollback()
    return markers, generations


def verify_cycle(sink, phase, ordinal, before, after, generations):
    operation = phase.upper()
    expected = {
        feed: after.get((feed, operation), 0) - before.get((feed, operation), 0)
        for feed in FEEDS
    }
    if any(value != 1 for value in expected.values()):
        raise RuntimeError("TEN_FEED_MARKER_PARITY_FAILED")
    if set(generations) != set(FEEDS) or any(generations[feed] != ordinal for feed in FEEDS):
        raise RuntimeError("TEN_FEED_GENERATION_PARITY_FAILED")
    return {"operation": operation, "feeds": len(expected),
            "markers_added": sum(expected.values()),
            "generation": ordinal}


def drive(delay_seconds=2):
    require_isolation()
    if not isinstance(delay_seconds, int) or isinstance(delay_seconds, bool) or not 0 <= delay_seconds <= 10:
        raise ValueError("delay must be 0..10 seconds")
    # Only an EMPTY synthetic fixture can be bootstrapped at the current tip.
    src = source_connection()
    sink = connect("cdc")
    repl = connect("replica")
    try:
        with src.cursor() as cursor:
            for feed in FEEDS:
                # Static allowlist; never interpolate untrusted input.
                cursor.execute("SELECT COUNT(*) FROM `" + feed + "`")
                if int(cursor.fetchone()[0]) != 0:
                    raise RuntimeError("TEN_FEED_SOURCE_MUST_BE_EMPTY")
        src.rollback()
        with repl.cursor() as cursor:
            cursor.execute("SHOW BINARY LOG STATUS")
            coords = cursor.fetchone()
        repl.rollback()
        if not coords:
            raise RuntimeError("TEN_FEED_BINLOG_UNAVAILABLE")
        filename, position = coords[:2]
        handoff = SnapshotHandoff(
            schema="ingest_stage", binlog_file=filename,
            binlog_position=int(position), snapshot_consistent=True,
            snapshot_import_verified=True,
            snapshot_manifest_sha256=hashlib.sha256(
                b"empty-local-ten-feed-only-snapshot").hexdigest(),
            retention_hours=1,
        )
        result = bootstrap_local_sink(sink, handoff, consumer_name=CONSUMER)
        if result != "BOOTSTRAPPED":
            raise RuntimeError("TEN_FEED_CHECKPOINT_ALREADY_EXISTS")
        previous, _ = read_counts(sink)
        for ordinal, phase in enumerate(EVENTS, start=1):
            # One atomic transaction per cycle, across ALL TEN feeds.
            src.rollback()
            try:
                with src.cursor() as cursor:
                    for offset, feed in enumerate(FEEDS):
                        row_id = 91001 + offset
                        sql = STATIC_SQL[feed][phase]
                        if phase == "insert":
                            value = Decimal("1000.00") if feed == "debt_accounts" else "ACTIVE"
                            args = (row_id, value, "2025-01-01T00:00:00Z")
                        elif phase == "update":
                            value = Decimal("750.00") if feed == "debt_accounts" else "UPDATED"
                            args = (value, row_id)
                        else:
                            args = (row_id,)
                        affected = cursor.execute(sql, args)
                        if affected != 1:
                            raise RuntimeError("TEN_FEED_MUTATION_PARITY_FAILED")
                src.commit()
            except Exception:
                src.rollback()
                raise
            # The isolated MySQL server emits one committed XID for all ten.
            consumed = run_local_binlog(
                sink_db=sink, handoff=handoff, hmac_secret=HMAC_SECRET,
                consumer_name=CONSUMER, max_commits=1,
                max_packets=500, max_seconds=20,
            )
            if consumed["commits"] != 1 or consumed["markers"] != 10:
                raise RuntimeError("TEN_FEED_CDC_COMMIT_PARITY_FAILED")
            current, generations = read_counts(sink)
            summary = verify_cycle(sink, phase, ordinal, previous, current, generations)
            summary.update(kind="ten_feed_cycle",
                           source="DISPOSABLE_MYSQL_FIXTURE_NOT_LIVE_RDS",
                           checkpoint_advanced=True,
                           source_timestamp_expected_stale=(phase == "update"))
            print(json.dumps(summary), flush=True)
            previous = current
            if phase != EVENTS[-1]:
                time.sleep(delay_seconds)
        print(json.dumps({"kind": "ten_feed_demo_complete",
                          "feeds": len(FEEDS), "committed_source_transactions": 3,
                          "cdc_markers": 30,
                          "dashboard_connected": False}), flush=True)
    finally:
        src.rollback()
        sink.rollback()
        repl.rollback()
        src.close()
        sink.close()
        repl.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--delay-seconds", type=int, default=2)
    args = parser.parse_args()
    try:
        drive(args.delay_seconds)
    except Exception:
        print(json.dumps({"kind": "ten_feed_demo_error",
                          "code": "TEN_FEED_DEMO_FAILED"}), flush=True)
        raise SystemExit(1)
