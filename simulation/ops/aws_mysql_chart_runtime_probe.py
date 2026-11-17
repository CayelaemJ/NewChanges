"""Explicitly approved, one-query, read-only RDS reporting smoke test.

Measures one parameterized GROUP BY on v_journeys. On synthetic RDS only,
can discover one employer internally; never logs the ref or chart values.
No PostgreSQL, no CDC state writes, and no source DML/DDL.
"""
import json
import os
import sys
import time

from ops.aws_test_readiness import safe_failure_code, validate_environment

APPROVAL = "YES_READONLY_CHART_PROBE"
MAX_GROUPS = 20
DISCOVER_SQL = (
    "SELECT /*+ MAX_EXECUTION_TIME(3000) */ `employer_ref` "
    "FROM `ingest_stage`.`v_journeys` WHERE `employer_ref` IS NOT NULL LIMIT 1"
)
SQL = (
    "SELECT /*+ MAX_EXECUTION_TIME(5000) */ `status` AS bucket, COUNT(*) AS value "
    "FROM `ingest_stage`.`v_journeys` WHERE `employer_ref`=%s "
    "GROUP BY `status` ORDER BY value DESC, bucket ASC LIMIT 21"
)


def probe(conn, employer_ref=None, *, repeats=1):
    """Measure server round trips independently on one read-only connection.

    repeats=1 preserves existing offline probe contract; the CLI uses three
    bounded aggregations with a single discovery. No source values leave this
    function, even if returned data changes between samples.
    """
    if not isinstance(repeats, int) or isinstance(repeats, bool) or not 1 <= repeats <= 3:
        raise ValueError("CHART_REPETITION_BUDGET_INVALID")
    if employer_ref is not None and (
        not isinstance(employer_ref, str) or not employer_ref.strip()
        or len(employer_ref) > 200 or employer_ref != employer_ref.strip()
    ):
        raise ValueError("AUTHORIZED_EMPLOYER_REF_REQUIRED")
    auto_mode = employer_ref is None
    started = time.perf_counter()
    with conn.cursor() as cur:
        cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        cur.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY")
        transaction_ms = round((time.perf_counter() - started) * 1000, 2)
        discovery_ms = None
        if employer_ref is None:
            discovery_started = time.perf_counter()
            cur.execute(DISCOVER_SQL)
            candidates = cur.fetchall()
            discovery_ms = round((time.perf_counter() - discovery_started) * 1000, 2)
            if not candidates:
                return {
                    "status": "NO_JOURNEY_EMPLOYER_INCONCLUSIVE",
                    "query": "JOURNEYS_STATUS_AGGREGATION",
                    "read_only": True,
                    "source_rows_exported": False,
                    "employer_selection": "AUTO_SYNTHETIC_FIXTURE",
                    "groups": 0,
                    "elapsed_ms": round((time.perf_counter() - started) * 1000, 2),
                    "transaction_setup_ms": transaction_ms,
                    "discovery_ms": discovery_ms,
                    "aggregation_samples_ms": [],
                }
            if len(candidates) != 1 or not isinstance(candidates[0], tuple) or len(candidates[0]) != 1:
                raise ValueError("CHART_DISCOVERY_RESULT_INVALID")
            employer_ref = candidates[0][0]
            if not isinstance(employer_ref, str) or not employer_ref.strip() or (
                len(employer_ref) > 200 or employer_ref != employer_ref.strip()
            ):
                raise ValueError("CHART_DISCOVERY_RESULT_INVALID")
        samples = []
        group_counts = []
        fingerprints = []
        for _ in range(repeats):
            aggregation_started = time.perf_counter()
            cur.execute(SQL, (employer_ref,))
            rows = cur.fetchall()
            samples.append(round((time.perf_counter() - aggregation_started) * 1000, 2))
            if len(rows) > MAX_GROUPS:
                raise ValueError("CHART_GROUP_LIMIT_EXCEEDED")
            for row in rows:
                if not isinstance(row, tuple) or len(row) != 2:
                    raise ValueError("CHART_RESULT_INVALID")
                count = row[1]
                if isinstance(count, bool) or not isinstance(count, int) or count < 0:
                    raise ValueError("CHART_RESULT_INVALID")
            group_counts.append(len(rows))
            # Compare within this snapshot only. No buckets or counts emitted.
            fingerprints.append(tuple(rows))
    elapsed_ms = round((time.perf_counter() - started) * 1000, 2)
    if len(set(group_counts)) != 1 or any(fp != fingerprints[0] for fp in fingerprints):
        raise ValueError("CHART_REPEAT_RESULT_CHANGED")
    return {
        "status": "PASS" if group_counts[0] else "EMPTY_SCOPE_INCONCLUSIVE",
        "query": "JOURNEYS_STATUS_AGGREGATION",
        "read_only": True,
        "source_rows_exported": False,
        "employer_selection": "AUTO_SYNTHETIC_FIXTURE" if auto_mode else "SUPPLIED",
        "groups": group_counts[0],
        "elapsed_ms": elapsed_ms,
        "transaction_setup_ms": transaction_ms,
        "discovery_ms": discovery_ms,
        "aggregation_samples_ms": samples,
        "aggregation_min_ms": min(samples),
        "aggregation_max_ms": max(samples),
        "aggregation_mean_ms": round(sum(samples) / len(samples), 2),
        "target_query_ms": 5000,
        "within_target": all(value <= 5000 for value in samples),
        "latency_includes_session_setup": True,
        "connection_setup_measured_separately": True,
    }

def main():
    conn = None
    try:
        if os.getenv("FIXER_CDC_CHART_RUNTIME_APPROVED") != APPROVAL:
            raise ValueError("CHART_RUNTIME_APPROVAL_REQUIRED")
        if os.getenv("FIXER_RDS_TEST_USER") != "fixer_cdc_reader":
            raise ValueError("DEDICATED_READONLY_ACCOUNT_REQUIRED")
        employer_ref = os.getenv("FIXER_CDC_CHART_EMPLOYER_REF")
        if employer_ref is None and os.getenv("FIXER_CDC_CHART_AUTO_SAMPLE") != "YES_SYNTHETIC_FIXTURE":
            raise ValueError("AUTHORIZED_EMPLOYER_REF_REQUIRED")
        if employer_ref is None and os.getenv("FIXER_RDS_TEST_HOST", "").split(".")[0] != "fixer-synthetic-mysql":
            raise ValueError("AUTO_SAMPLE_SYNTHETIC_RDS_ONLY")
        env = dict(os.environ)
        env["FIXER_AWS_TEST_READONLY_APPROVED"] = "YES_METADATA_ONLY"
        config = validate_environment(env)
        import pymysql
        connection_started = time.perf_counter()
        conn = pymysql.connect(
            host=config["host"], port=config["port"], user=config["user"],
            password=config["password"], database="ingest_stage",
            ssl_ca=config["ca"], ssl_verify_cert=True, ssl_verify_identity=True,
            connect_timeout=5, read_timeout=8, write_timeout=5, autocommit=False,
        )
        connection_ms = round((time.perf_counter() - connection_started) * 1000, 2)
        output = probe(conn, employer_ref, repeats=3)
        output["connection_ms"] = connection_ms
        output["overall_ms_including_connection"] = round(connection_ms + output["elapsed_ms"], 2)
        print(json.dumps(output, sort_keys=True))
        return 0 if output["status"] == "PASS" else 2
    except Exception as exc:
        allowed = {
            "CHART_RUNTIME_APPROVAL_REQUIRED", "DEDICATED_READONLY_ACCOUNT_REQUIRED",
            "AUTHORIZED_EMPLOYER_REF_REQUIRED", "CHART_GROUP_LIMIT_EXCEEDED",
            "CHART_RESULT_INVALID", "CHART_DISCOVERY_RESULT_INVALID",
            "AUTO_SAMPLE_SYNTHETIC_RDS_ONLY",
            "CHART_REPETITION_BUDGET_INVALID", "CHART_REPEAT_RESULT_CHANGED",
        }
        code = str(exc) if type(exc) is ValueError and str(exc) in allowed else safe_failure_code(exc)
        print(json.dumps({"status": "FAILED", "reason_code": code,
                          "query": "JOURNEYS_STATUS_AGGREGATION",
                          "source_rows_exported": False, "read_only": True}, sort_keys=True))
        return 1
    finally:
        if conn is not None:
            try:
                conn.rollback()
            finally:
                conn.close()


if __name__ == "__main__":
    sys.exit(main())
