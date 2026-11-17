"""Read-only AWS RDS binlog inventory; no replication streaming or row reads.

Lists retained log SIZE aggregates only. No log positions, filenames, raw
events, source records or secrets are emitted. Size is not proof of relevant
ingest_stage changes: format/rotation/foreign-table events also consume bytes.
"""
import json
import os
import sys

from ops.aws_replication_stream_probe import probe_config
from ops.aws_test_readiness import safe_failure_code


def inspect_binlog_inventory(connection):
    with connection.cursor() as cursor:
        cursor.execute("SHOW BINARY LOGS")
        entries = cursor.fetchall()
        cursor.execute("SHOW BINARY LOG STATUS")
        current = cursor.fetchone()
        cursor.execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
        tls = cursor.fetchone()
    if not tls or not tls[1]:
        raise ValueError("TLS_NOT_NEGOTIATED")
    if not entries or not current or len(current) < 2:
        raise ValueError("BINLOG_INVENTORY_UNAVAILABLE")
    if not isinstance(current[0], str) or type(current[1]) is not int:
        raise ValueError("INVALID_CURRENT_BINLOG")
    if not any(row[0] == current[0] for row in entries):
        raise ValueError("CURRENT_BINLOG_NOT_RETAINED")
    sizes = []
    for row in entries:
        if len(row) < 2 or not isinstance(row[0], str) or type(row[1]) is not int or row[1] < 0:
            raise ValueError("INVALID_BINLOG_METADATA")
        sizes.append(row[1])
    return {
        "mode": "AWS_BINLOG_METADATA_INVENTORY_ONLY",
        "status": "PASS",
        "retained_log_count": len(entries),
        "retained_log_sizes_bytes": {
            "minimum": min(sizes), "maximum": max(sizes),
            "total": sum(sizes), "current": next(row[1] for row in entries if row[0] == current[0]),
        },
        "noncurrent_logs": sum(row[0] != current[0] for row in entries),
        "source_table_activity": "UNVERIFIED_FROM_BINLOG_SIZES",
        "replication_stream_started": False,
        "checkpoint_created": False,
        "source_rows_read": False,
    }


def main():
    try:
        if os.environ.get("FIXER_CDC_BINLOG_INVENTORY_APPROVED") != "YES_METADATA_ONLY":
            raise ValueError("BINLOG_INVENTORY_APPROVAL_REQUIRED")
        config, _ = probe_config()
        import pymysql
        connection = pymysql.connect(
            host=config["host"], port=config["port"], user=config["user"],
            password=config["password"], database="information_schema",
            ssl_ca=config["ca"], ssl_verify_cert=True, ssl_verify_identity=True,
            connect_timeout=8, read_timeout=15, write_timeout=5,
        )
        try:
            result = inspect_binlog_inventory(connection)
        finally:
            connection.close()
        print(json.dumps(result,sort_keys=True))
        return 0
    except Exception as exc:
        reason = str(exc) if type(exc) is ValueError and str(exc) in {
            "BINLOG_INVENTORY_APPROVAL_REQUIRED", "TLS_NOT_NEGOTIATED",
            "BINLOG_INVENTORY_UNAVAILABLE", "INVALID_CURRENT_BINLOG",
            "CURRENT_BINLOG_NOT_RETAINED", "INVALID_BINLOG_METADATA",
        } else safe_failure_code(exc)
        print(json.dumps({"mode":"AWS_BINLOG_METADATA_INVENTORY_ONLY",
            "status":"FAILED","reason_code":reason},sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
