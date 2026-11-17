"""Read-only, bounded readiness probe for an explicitly approved AWS RDS TEST MySQL.

No source records, view definitions, triggers, passwords, DDL or DML.
This does NOT initialize or activate CDC. Run manually, never scheduled.
"""
import json
import os
import re
import sys

from runtime.ingest_stage_contract import FEED_TABLES

RDS_SUFFIX = ".rds.amazonaws.com"
VIEWS = tuple("v_" + feed for feed in sorted(FEED_TABLES))
SETTINGS = ("log_bin", "binlog_format", "binlog_row_image")


def validate_environment(environ=None):
    env = os.environ if environ is None else environ
    if env.get("FIXER_AWS_TEST_READONLY_APPROVED") != "YES_METADATA_ONLY":
        raise RuntimeError("AWS_TEST_READONLY_APPROVAL_REQUIRED")
    host = env.get("FIXER_RDS_TEST_HOST", "")
    if not re.fullmatch(r"[a-zA-Z0-9.-]{1,253}", host) or not host.endswith(RDS_SUFFIX) or ".." in host:
        raise RuntimeError("AWS_TEST_RDS_ENDPOINT_INVALID")
    if not re.fullmatch(r"[0-9]{1,5}", env.get("FIXER_RDS_TEST_PORT", "3306")):
        raise RuntimeError("AWS_TEST_RDS_PORT_INVALID")
    port = int(env.get("FIXER_RDS_TEST_PORT", "3306"))
    if not 1 <= port <= 65535:
        raise RuntimeError("AWS_TEST_RDS_PORT_INVALID")
    user = env.get("FIXER_RDS_TEST_USER", "")
    if not re.fullmatch(r"[a-zA-Z0-9_]{1,64}", user) or user.lower() in {
        "root", "admin", "master", "rdsadmin"
    }:
        raise RuntimeError("AWS_TEST_READER_USER_INVALID")
    if not env.get("FIXER_RDS_TEST_PASSWORD"):
        raise RuntimeError("AWS_TEST_READER_PASSWORD_MISSING")
    ca = env.get("FIXER_RDS_TEST_CA", "")
    if not ca or not os.path.isfile(ca):
        raise RuntimeError("AWS_TEST_TLS_CA_MISSING")
    return {"host": host, "port": port, "user": user,
            "password": env["FIXER_RDS_TEST_PASSWORD"], "ca": ca}


def inspect(connection):
    # Only information_schema metadata and MySQL global variables.
    with connection.cursor() as cursor:
        cursor.execute("""SELECT TABLE_NAME,TABLE_TYPE FROM information_schema.TABLES
             WHERE TABLE_SCHEMA=%s AND TABLE_NAME IN (""" +
             ",".join(["%s"] * len(VIEWS)) + ")", ("ingest_stage", *VIEWS))
        view_types = dict(cursor.fetchall())
        cursor.execute("""SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA=%s AND COLUMN_NAME IN (%s,%s,%s)
               AND (TABLE_NAME IN (""" +
             ",".join(["%s"] * len(VIEWS)) + """)
                 OR TABLE_NAME IN (""" +
             ",".join(["%s"] * len(FEED_TABLES)) + "))",
             ("ingest_stage", "_ingest_id", "source_updated_at", "employer_ref",
              *VIEWS, *sorted(FEED_TABLES)))
        columns = {(table, col) for table, col in cursor.fetchall()}
        cursor.execute("""SHOW GLOBAL VARIABLES WHERE Variable_name IN
             ('log_bin','binlog_format','binlog_row_image')""")
        variables = {name.lower(): str(value).upper() for name, value in cursor.fetchall()}
    view_inventory = {}
    for feed in sorted(FEED_TABLES):
        view = "v_" + feed
        view_inventory[feed] = {
            "view_present": view_types.get(view) == "VIEW",
            "view_watermark": (view, "source_updated_at") in columns,
            "view_employer_ref": (view, "employer_ref") in columns,
            "physical_ingest_id": (feed, "_ingest_id") in columns,
            "view_ingest_id": (view, "_ingest_id") in columns,
        }
    return {
        "mode": "READ_ONLY_METADATA_NO_CDC",
        "view_inventory": view_inventory,
        "binlog": {
            "enabled": variables.get("log_bin") in ("ON", "1"),
            "row": variables.get("binlog_format") == "ROW",
            "full": variables.get("binlog_row_image") == "FULL",
        },
        "retention_hours": "UNVERIFIED_REQUIRES_APPROVED_RDS_ADMIN_CHECK",
        "replication_privileges": "UNVERIFIED_REQUIRES_REVIEW",
        "snapshot": "NOT_VERIFIED",
        "aws_live_cdc": "NOT_ENABLED",
    }



SAFE_CONFIGURATION_CODES = frozenset({
    "AWS_TEST_READONLY_APPROVAL_REQUIRED", "AWS_TEST_RDS_ENDPOINT_INVALID",
    "AWS_TEST_RDS_PORT_INVALID", "AWS_TEST_READER_USER_INVALID",
    "AWS_TEST_READER_PASSWORD_MISSING", "AWS_TEST_TLS_CA_MISSING",
})


def safe_failure_code(exc):
    """Classify failures without printing driver strings or server details."""
    if type(exc) is RuntimeError and str(exc) in SAFE_CONFIGURATION_CODES:
        return str(exc)
    if isinstance(exc, (ModuleNotFoundError, ImportError)):
        return "PYMYSQL_NOT_INSTALLED_IN_ACTIVE_PYTHON"
    # MySQL numeric protocol codes; no arbitrary exception text in output.
    code = getattr(exc, "args", (None,))[0] if getattr(exc, "args", ()) else None
    if type(code) is int:
        if code in (1044, 1045, 1698):
            return "RDS_AUTHENTICATION_OR_DATABASE_ACCESS_DENIED"
        if code in (2003, 2005, 2006, 2013):
            return "RDS_NETWORK_DNS_OR_CONNECTION_FAILED"
        if code in (2026,):
            return "RDS_TLS_CERTIFICATE_OR_HANDSHAKE_FAILED"
        if code in (1142, 1227):
            return "RDS_METADATA_QUERY_PRIVILEGE_DENIED"
    return "RDS_READONLY_PROBE_FAILED_UNCLASSIFIED"


def main():
    try:
        config = validate_environment()
        import pymysql
        connection = pymysql.connect(
            host=config["host"], port=config["port"], user=config["user"],
            password=config["password"], database="information_schema",
            ssl={"ca": config["ca"]}, ssl_verify_cert=True,
            ssl_verify_identity=True, connect_timeout=5, read_timeout=8,
            write_timeout=5, autocommit=False,
        )
        try:
            result = inspect(connection)
        finally:
            connection.rollback()
            connection.close()
        print(json.dumps(result, sort_keys=True))
    except Exception as exc:
        # Never leak driver errors (may contain SQL, hosts or credentials).
        print(json.dumps({"mode": "READ_ONLY_METADATA_NO_CDC",
                          "status": "FAILED", "reason_code": safe_failure_code(exc)}))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
