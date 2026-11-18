"""Read-only, bounded MySQL native chart metadata and optional EXPLAIN audit.

No source rows, view definitions, stored SQL plans, DDL, DML or app-store access.
EXPLAIN (not EXPLAIN ANALYZE) estimates query access; it is NOT measured latency.
"""
import json
import os
import sys

from ops.aws_test_readiness import safe_failure_code, validate_environment
from runtime.ingest_stage_contract import FEED_TABLES

# Conservative first-pass chart dimensions; validated against live view columns.
# Keep in sync with src/services/ingestStageMysqlChartQuery.ts.
DIMENSIONS = {
    "employers": ("name",),
    "workforce_snapshots": ("as_of_date",),
    "employees": ("site_name", "income_band", "active"),
    "platform_users": ("has_credit_profile",),
    "journeys": ("status", "type"),
    "debt_accounts": ("credit_type", "in_arrears", "state"),
    "policies": ("type", "is_wasteful", "is_resolved"),
    "ratings": ("stars", "journey_type"),
    "referrals": ("channel", "converted"),
    "salary_advances": ("salary_advance_status", "bank_account_verification_status"),
}
def explain_failure_code(exc):
    """Report only a numeric MySQL error and safe broad class, never messages."""
    args = getattr(exc, "args", ())
    errno = args[0] if args and type(args[0]) is int else None
    if errno == 1345:
        category = "MYSQL_VIEW_EXPLAIN_PRIVILEGE_RESTRICTION"
    elif errno in {1044, 1045, 1142, 1227, 1370}:
        category = "MYSQL_PERMISSION_DENIED"
    elif errno in {1356, 1449}:
        category = "MYSQL_VIEW_DEFINER_OR_REFERENCE"
    elif errno in {1054, 1064, 1109}:
        category = "MYSQL_QUERY_CONTRACT"
    elif errno in {1205, 1317, 2003, 2006, 2013}:
        category = "MYSQL_CONNECTION_OR_TIMEOUT"
    elif errno is not None:
        category = "MYSQL_SERVER_ERROR"
    else:
        category = "CLIENT_OR_RESULT_PARSING_ERROR"
    return {"status": "EXPLAIN_NOT_AVAILABLE", "category": category,
            "mysql_errno": errno}


EXPECTED = tuple(sorted(FEED_TABLES))
assert set(DIMENSIONS) == set(FEED_TABLES)


def inspect(conn, *, include_explain=False):
    with conn.cursor() as cur:
        cur.execute(
            "SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA=%s AND TABLE_NAME IN ("
            + ",".join(["%s"] * len(EXPECTED)) + ") "
            "ORDER BY TABLE_NAME,ORDINAL_POSITION",
            ("ingest_stage", *tuple("v_" + t for t in EXPECTED)),
        )
        column_rows = cur.fetchall()
        cur.execute(
            "SELECT TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME "
            "FROM information_schema.STATISTICS "
            "WHERE TABLE_SCHEMA=%s AND TABLE_NAME IN ("
            + ",".join(["%s"] * len(EXPECTED)) + ") "
            "ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX",
            ("ingest_stage", *EXPECTED),
        )
        indexes = cur.fetchall()
        indexed = {t: [] for t in EXPECTED}
        for table, index_name, seq, col in indexes:
            if table in indexed and int(seq) == 1:
                indexed[table].append(col)
        available = {t: set() for t in EXPECTED}
        for view, column in column_rows:
            if view.startswith("v_") and view[2:] in available:
                available[view[2:]].add(column)
        result = {}
        for feed in EXPECTED:
            cols = available[feed]
            dimensions = {name: name in cols for name in DIMENSIONS[feed]}
            meta = {
                "view_exists_with_employer_ref": "employer_ref" in cols,
                "available_chart_dimensions": [d for d, yes in dimensions.items() if yes],
                "missing_chart_dimensions": [d for d, yes in dimensions.items() if not yes],
                "base_table_employer_ref_leading_index": "employer_ref" in indexed[feed],
                "explain": {},
            }
            # Never run EXPLAIN for missing columns or nonexistent views.
            if include_explain and meta["view_exists_with_employer_ref"]:
                for dim in meta["available_chart_dimensions"]:
                    # Identifiers are program-owned and validated by allowlist.
                    sql = (
                        "EXPLAIN SELECT `" + dim + "` AS bucket, COUNT(*) AS value "
                        "FROM `ingest_stage`.`v_" + feed + "` "
                        "WHERE `employer_ref` = %s GROUP BY `" + dim +
                        "` ORDER BY value DESC, bucket ASC LIMIT 21"
                    )
                    try:
                        cur.execute(sql, ("__CDC_EXPLAIN_NONMATCHING_SCOPE__",))
                        plans = cur.fetchall()
                        # Never output raw query plan text. EXPLAIN estimates are
                        # directional; no real query timings are claimed.
                        meta["explain"][dim] = {
                            "plan_rows": len(plans),
                            "estimated_rows_total": sum(
                                max(0, int(p[9] or 0)) for p in plans
                            ),
                            "access_types": sorted(set(
                                str(p[4]) for p in plans
                            )),
                        }
                    except Exception as exc:
                        # Never disclose SQL, server error text, view bodies, or row data.
                        meta["explain"][dim] = explain_failure_code(exc)
            result[feed] = meta
    complete = all(item["view_exists_with_employer_ref"] and
                   not item["missing_chart_dimensions"] for item in result.values())
    explain_complete = (not include_explain or all(
        all(isinstance(detail, dict) and "estimated_rows_total" in detail
            for detail in item["explain"].values()) and
        len(item["explain"]) == len(item["available_chart_dimensions"])
        for item in result.values()
    ))
    return {
        "mode": "AWS_MYSQL_CHART_CONTRACT_AND_PLAN_READONLY",
        "status": "PASS" if complete and explain_complete else "REVIEW_REQUIRED",
        "explain_requested": bool(include_explain),
        "explain_analyze_executed": False,
        "source_rows_read": False,
        "aws_writes_performed": False,
        "latency_measured": False,
        "feeds": result,
    }


def main():
    try:
        if os.getenv("FIXER_CDC_CHART_AUDIT_APPROVED") != "YES_METADATA_ONLY":
            raise ValueError("CHART_AUDIT_APPROVAL_REQUIRED")
        if os.getenv("FIXER_RDS_TEST_USER") != "fixer_cdc_reader":
            raise ValueError("DEDICATED_READONLY_ACCOUNT_REQUIRED")
        env = dict(os.environ)
        env["FIXER_AWS_TEST_READONLY_APPROVED"] = "YES_METADATA_ONLY"
        config = validate_environment(env)
        do_explain = env.get("FIXER_CDC_CHART_EXPLAIN_APPROVED") == "YES_READONLY_EXPLAIN"
        import pymysql
        conn = pymysql.connect(
            host=config["host"], port=config["port"], user=config["user"],
            password=config["password"], database="information_schema",
            ssl_ca=config["ca"], ssl_verify_cert=True, ssl_verify_identity=True,
            connect_timeout=5, read_timeout=15, write_timeout=5, autocommit=False,
        )
        try:
            output = inspect(conn, include_explain=do_explain)
        finally:
            conn.rollback()
            conn.close()
        print(json.dumps(output, sort_keys=True))
        return 0 if output["status"] == "PASS" else 2
    except Exception as exc:
        code = str(exc) if type(exc) is ValueError and str(exc) in {
            "CHART_AUDIT_APPROVAL_REQUIRED", "DEDICATED_READONLY_ACCOUNT_REQUIRED"
        } else safe_failure_code(exc)
        print(json.dumps({
            "mode": "AWS_MYSQL_CHART_CONTRACT_AND_PLAN_READONLY",
            "status": "FAILED", "reason_code": code,
            "aws_writes_performed": False,
        }, sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
