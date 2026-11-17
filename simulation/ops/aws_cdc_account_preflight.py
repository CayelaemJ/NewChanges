"""Read-only AWS CDC account preflight: no replication stream or source row reads.

This tests whether the dedicated CDC account is ready for a separately
approved, bounded binlog probe. Never prints passwords, row values,
binlog filenames, full grants, server IDs, or connection exceptions.
"""
import json
import os
import sys

from ops.aws_test_readiness import safe_failure_code, validate_environment


def audit_cdc_account(connection):
    with connection.cursor() as cursor:
        cursor.execute("SHOW GRANTS")
        grants = [str(row[0]).upper() for row in cursor.fetchall()]
        cursor.execute("SHOW BINARY LOG STATUS")
        status = cursor.fetchone()
        cursor.execute("SHOW BINARY LOGS")
        files = cursor.fetchall()
        cursor.execute("SHOW SESSION STATUS LIKE 'Ssl_cipher'")
        cipher_row = cursor.fetchone()
        cursor.execute("SHOW GLOBAL VARIABLES WHERE Variable_name IN "
                       "('log_bin','binlog_format','binlog_row_image')")
        settings = {str(k).lower(): str(v).upper() for k,v in cursor.fetchall()}

    def global_grant(name):
        return any(name in grant and "ON *.*" in grant for grant in grants)

    has_schema_select = any(
        "SELECT" in grant and ("ON `INGEST_STAGE`.*" in grant or
                               "ON INGEST_STAGE.*" in grant)
        for grant in grants
    )
    cipher = (str(cipher_row[1]) if cipher_row and len(cipher_row) > 1 else "")
    verified = {
        "replication_client": global_grant("REPLICATION CLIENT"),
        "replication_slave": (global_grant("REPLICATION SLAVE")
                              or global_grant("REPLICATION REPLICA")),
        "source_schema_select": has_schema_select,
        "binlog_status_available": bool(status and len(status) >= 2
                                        and isinstance(status[0], str)
                                        and isinstance(status[1], int)),
        "binlog_inventory_nonempty": bool(files),
        "binlog_status_file_in_inventory": bool(
            status and files and any(row[0] == status[0] for row in files)
        ),
        "tls_cipher_negotiated": bool(cipher and cipher.upper() != "NULL"),
        "row_logging": settings.get("binlog_format") == "ROW",
        "full_row_image": settings.get("binlog_row_image") == "FULL",
        "binlog_enabled": settings.get("log_bin") in ("ON", "1"),
    }
    return {
        "mode": "AWS_CDC_ACCOUNT_METADATA_ONLY",
        "status": "PASS" if all(verified.values()) else "REVIEW_REQUIRED",
        "checks": verified,
        "source_rows_read": False,
        "replication_stream_started": False,
        "checkpoint_created": False,
    }


def main():
    try:
        # Reuse TLS and endpoint validator, but bind the CDC identity and
        # password separately from the metadata-only reader.
        env = dict(os.environ)
        if env.get("FIXER_AWS_TEST_CDC_METADATA_APPROVED") != "YES_CDC_ACCOUNT_METADATA":
            raise RuntimeError("AWS_CDC_METADATA_APPROVAL_REQUIRED")
        if env.get("FIXER_RDS_TEST_USER") != "fixer_cdc_stream":
            raise RuntimeError("AWS_CDC_DEDICATED_USER_REQUIRED")
        env["FIXER_AWS_TEST_READONLY_APPROVED"] = "YES_METADATA_ONLY"
        env["FIXER_RDS_TEST_PASSWORD"] = env.get("FIXER_CDC_PASSWORD", "")
        config = validate_environment(env)
        import pymysql
        conn = pymysql.connect(
            host=config["host"],port=config["port"],user=config["user"],
            password=config["password"],database="information_schema",
            ssl_ca=config["ca"],ssl_verify_cert=True,
            ssl_verify_identity=True,connect_timeout=8,read_timeout=15,
            write_timeout=5,autocommit=False
        )
        try:
            result = audit_cdc_account(conn)
        finally:
            conn.rollback()
            conn.close()
        print(json.dumps(result,sort_keys=True))
        return 0 if result["status"] == "PASS" else 2
    except Exception as exc:
        code = (str(exc) if type(exc) is RuntimeError and str(exc) in {
            "AWS_CDC_METADATA_APPROVAL_REQUIRED","AWS_CDC_DEDICATED_USER_REQUIRED"
        } else safe_failure_code(exc))
        print(json.dumps({"mode":"AWS_CDC_ACCOUNT_METADATA_ONLY",
                          "status":"FAILED","reason_code":code},sort_keys=True))
        return 1


if __name__ == "__main__":
    sys.exit(main())
