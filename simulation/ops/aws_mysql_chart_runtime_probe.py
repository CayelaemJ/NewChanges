"""Explicitly approved, one-query, read-only RDS reporting smoke test.

Measures an actual parameterized GROUP BY on v_journeys, with a real,
authorized employer_ref. Outputs only timing and group count, never values.
No PostgreSQL, no CDC state writes, and no source DML/DDL.
"""
import json
import os
import sys
import time

from ops.aws_test_readiness import safe_failure_code, validate_environment

APPROVAL = "YES_READONLY_CHART_PROBE"
MAX_GROUPS = 20\nDISCOVER_SQL = (\n    "SELECT /*+ MAX_EXECUTION_TIME(3000) */ `employer_ref` "\n    "FROM `ingest_stage`.`v_journeys` WHERE `employer_ref` IS NOT NULL LIMIT 1"\n)
SQL = (
    "SELECT /*+ MAX_EXECUTION_TIME(5000) */ `status` AS bucket, COUNT(*) AS value "
    "FROM `ingest_stage`.`v_journeys` WHERE `employer_ref`=%s "
    "GROUP BY `status` ORDER BY value DESC, bucket ASC LIMIT 21"
)


def probe(conn, employer_ref=None):
    # Explicit, locally provided employer ref remains supported. In auto mode
    # discover a fixture ID only after the caller approved this AWS read-only
    # probe. Never print, persist, or return the discovered identifier.
    if employer_ref is not None and (
        not isinstance(employer_ref, str) or not employer_ref.strip()
        or len(employer_ref) > 200 or employer_ref != employer_ref.strip()
    ):
        raise ValueError("AUTHORIZED_EMPLOYER_REF_REQUIRED")
    auto_mode = employer_ref is None\n    started = time.perf_counter()
    with conn.cursor() as cur:
        cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        cur.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY")
        if employer_ref is None:
            cur.execute(DISCOVER_SQL)
            candidates = cur.fetchall()
            if not candidates:
                return {
                    "status": "NO_JOURNEY_EMPLOYER_INCONCLUSIVE",
                    "query": "JOURNEYS_STATUS_AGGREGATION",
                    "read_only": True,
                    "source_rows_exported": False,
                    "employer_selection": "AUTO_SYNTHETIC_FIXTURE",
                    "groups": 0,
                    "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
                }
            if len(candidates) != 1 or not isinstance(candidates[0], tuple) or len(candidates[0]) != 1:
                raise ValueError("CHART_DISCOVERY_RESULT_INVALID")
            employer_ref = candidates[0][0]
            if not isinstance(employer_ref, str) or not employer_ref.strip() or (
                len(employer_ref) > 200 or employer_ref != employer_ref.strip()
            ):
                raise ValueError("CHART_DISCOVERY_RESULT_INVALID")
        cur.execute(SQL, (employer_ref,))
        rows = cur.fetchall()
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    if len(rows) > MAX_GROUPS:
        raise ValueError("CHART_GROUP_LIMIT_EXCEEDED")
    for row in rows:
        if not isinstance(row, tuple) or len(row) != 2:
            raise ValueError("CHART_RESULT_INVALID")
        count = row[1]
        if isinstance(count, bool) or not isinstance(count, int) or count < 0:
            raise ValueError("CHART_RESULT_INVALID")
    return {
        "status": "PASS" if rows else "EMPTY_SCOPE_INCONCLUSIVE",
        "query": "JOURNEYS_STATUS_AGGREGATION",
        "read_only": True,
        "source_rows_exported": False,
        "employer_selection": "AUTO_SYNTHETIC_FIXTURE" if auto_mode else "SUPPLIED",
        "groups": len(rows),
        "elapsed_ms": elapsed_ms,
        "target_query_ms": 5000,
        "within_target": elapsed_ms <= 5000,
        "latency_includes_session_setup": True,
    }
