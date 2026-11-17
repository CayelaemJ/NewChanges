"""AWS test source-contract audit: read-only metadata only, never CDC activation.

Requires the same explicit approval and TLS settings as aws_test_readiness.
Checks exactly 11 physical tables and 10 views without reading row data.
"""
import json
import sys

from ops.aws_test_readiness import safe_failure_code, validate_environment
from runtime.ingest_stage_contract import FEED_TABLES

EXPECTED_BASE = frozenset(FEED_TABLES) | {"import_manifest"}
EXPECTED_VIEWS = frozenset("v_" + x for x in FEED_TABLES)


def inspect_contract(connection):
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT TABLE_NAME,TABLE_TYPE,ENGINE FROM information_schema.TABLES "
            "WHERE TABLE_SCHEMA=%s", ("ingest_stage",)
        )
        objects = {name: (type_, engine) for name, type_, engine in cursor.fetchall()}
        cursor.execute(
            "SELECT TABLE_NAME,COLUMN_NAME,DATA_TYPE,COLUMN_KEY,EXTRA,"
            "GENERATION_EXPRESSION FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA=%s AND "
            "(COLUMN_NAME IN ('_ingest_id','source_updated_at','_source_updated_utc') "
            "OR (TABLE_NAME='import_manifest' AND COLUMN_NAME='loaded_at'))",
            ("ingest_stage",)
        )
        columns = {}
        for table, column, dtype, key, extra, expression in cursor.fetchall():
            columns.setdefault(table, {})[column] = {
                "type": dtype, "key": key, "extra": extra,
                "generated": bool(expression),
            }

    unexpected = sorted(set(objects) - EXPECTED_BASE - EXPECTED_VIEWS)
    missing = sorted((EXPECTED_BASE | EXPECTED_VIEWS) - set(objects))
    checks = {}
    for table in sorted(FEED_TABLES):
        physical = objects.get(table, (None, None))
        view = objects.get("v_" + table, (None, None))
        cols = columns.get(table, {})
        pk = cols.get("_ingest_id", {})
        raw = cols.get("source_updated_at", {})
        norm = cols.get("_source_updated_utc", {})
        checks[table] = {
            "base_innodb": physical == ("BASE TABLE", "InnoDB"),
            "matching_view_exists": view[0] == "VIEW",
            "primary_ingest_id_bigint": pk.get("key") == "PRI" and pk.get("type") == "bigint",
            "raw_source_timestamp_text": raw.get("type") == "text",
            "normalized_utc_generated_datetime": (
                norm.get("type") == "datetime" and
                "GENERATED" in (norm.get("extra") or "").upper() and
                norm.get("generated") is True
            ),
        }
    manifest = columns.get("import_manifest", {})
    result = {
        "mode": "AWS_TEST_METADATA_CONTRACT_ONLY",
        "unexpected_objects": unexpected,
        "missing_objects": missing,
        "manifest_loaded_at_timestamp": manifest.get("loaded_at", {}).get("type") == "timestamp",
        "feeds": checks,
        "live_cdc": "NOT_ACTIVATED",
    }
    result["status"] = ("PASS" if not missing and not unexpected
        and objects.get("import_manifest") == ("BASE TABLE", "InnoDB")
        and result["manifest_loaded_at_timestamp"]
        and all(all(flags.values()) for flags in checks.values())
        else "REVIEW_REQUIRED")
    return result


def main():
    try:
        config = validate_environment()
        import pymysql
        db = pymysql.connect(
            host=config["host"], port=config["port"], user=config["user"],
            password=config["password"], database="information_schema",
            ssl_ca=config["ca"], ssl_verify_cert=True,
            ssl_verify_identity=True, connect_timeout=8, read_timeout=15,
            write_timeout=5, autocommit=False,
        )
        try:
            result = inspect_contract(db)
        finally:
            db.rollback()
            db.close()
        print(json.dumps(result, sort_keys=True))
        return 0 if result["status"] == "PASS" else 2
    except Exception as exc:
        print(json.dumps({"mode": "AWS_TEST_METADATA_CONTRACT_ONLY",
                          "status": "FAILED", "reason_code": safe_failure_code(exc)}))
        return 1


if __name__ == "__main__":
    sys.exit(main())
