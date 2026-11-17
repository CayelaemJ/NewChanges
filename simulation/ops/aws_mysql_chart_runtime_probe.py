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
MAX_GROUPS = 20
SQL = (
    "SELECT /*+ MAX_EXECUTION_TIME(5000) */ `status` AS bucket, COUNT(*) AS value "
    "FROM `ingest_stage`.`v_journeys` WHERE `employer_ref`=%s "
    "GROUP BY `status` ORDER BY value DESC, bucket ASC LIMIT 21"
)


def probe(conn, employer_ref):
    if not isinstance(employer_ref, str) or not employer_ref.strip() or (
        len(employer_ref) > 200 or employer_ref != employer_ref.strip()
    ):
        raise ValueError("AUTHORIZED_EMPLOYER_REF_REQUIRED")
    started = time.perf_counter()
    with conn.cursor() as cur:
        cur.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        cur.execute("START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY")
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
        "groups": len(rows),
        "elapsed_ms": elapsed_ms,
        "target_query_ms": 5000,
        "within_target": elapsed_ms <= 5000,
        "latency_includes_session_setup": True,
    }


def main():
    conn = None
    try:
        if os.getenv("FIXER_CDC_CHART_RUNTIME_APPROVED") != APPROVAL:
            raise ValueError("CHART_RUNTIME_APPROVAL_REQUIRED")
        if os.getenv("FIXER_RDS_TEST_USER") != "fixer_cdc_reader":
            raise ValueError("DEDICATED_READONLY_ACCOUNT_REQUIRED")
        employer_ref = os.getenv("FIXER_CDC_CHART_EMPLOYER_REF", "")
        if not employer_ref or len(employer_ref) > 200 or employer_ref != employer_ref.strip():
            raise ValueError("AUTHORIZED_EMPLOYER_REF_REQUIRED")
        env = dict(os.environ)
        env["FIXER_AWS_TEST_READONLY_APPROVED"] = "YES_METADATA_ONLY"
        config = validate_environment(env)
        import pymysql
        conn = pymysql.connect(
            host=config["host"], port=config["port"], user=config["user"],
            password=config["password"], database="ingest_stage",
            ssl_ca=config["ca"], ssl_verify_cert=True, ssl_verify_identity=True,
            connect_timeout=5, read_timeout=8, write_timeout=5, autocommit=False,
        )
        output = probe(conn, employer_ref)
        print(json.dumps(output, sort_keys=True))
        return 0 if output["status"] == "PASS" else 2
    except Exception as exc:
        allowed = {
            "CHART_RUNTIME_APPROVAL_REQUIRED", "DEDICATED_READONLY_ACCOUNT_REQUIRED",
            "AUTHORIZED_EMPLOYER_REF_REQUIRED", "CHART_GROUP_LIMIT_EXCEEDED",
            "CHART_RESULT_INVALID",
        }
        code = str(exc) if type(exc) is ValueError and str(exc) in allowed else safe_failure_code(exc)
        print(json.dumps({"status":"FAILED", "reason_code":code, "query":"JOURNEYS_STATUS_AGGREGATION",
                          "source_rows_exported":False, "read_only":True},sort_keys=True))
        return 1
    finally:
        if conn is not None:
            try:
                conn.rollback()
            finally:
                conn.close()


if __name__ == "__main__":
    sys.exit(main())
