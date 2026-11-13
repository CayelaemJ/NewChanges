"""Read-only bootstrap diagnostics for the disposable MySQL Docker test only.

Run after setup_local.py; this script does not perform migrations, writes,
credential printing or network calls outside the isolated Compose service.
"""
import json
import os
import sys

from runtime.common import connect, redacted_error

TABLES = ("customers", "products", "orders", "order_items", "payments",
          "financial_transactions")
SAFE_ERRNOS = frozenset((1044, 1045, 1049, 1142, 1227))


def _query(connection, sql):
    with connection.cursor() as cursor:
        cursor.execute(sql)
        return cursor.fetchall()


def _stage(name, callback):
    try:
        result = callback()
        print(json.dumps({"check": name, "result": "PASS", **result}), flush=True)
        return True
    except Exception as exc:
        payload = {"check": name, "result": "FAIL",
                   "error_type": redacted_error(exc)}
        if getattr(exc, "args", ()) and isinstance(exc.args[0], int):
            if exc.args[0] in SAFE_ERRNOS:
                payload["mysql_errno"] = exc.args[0]
        print(json.dumps(payload), flush=True)
        return False


def main():
    if not (os.environ.get("SIM_ENV") == "local"
            and os.environ.get("RUN_LOCAL_MYSQL_TESTS") == "yes"
            and os.environ.get("SIM_DB_HOST") == "mysql"
            and os.environ.get("SIM_REPL_HOST") == "mysql"
            and os.environ.get("SIM_CDC_HOST") == "mysql"):
        raise SystemExit("Local-only bootstrap probe refused")

    def sha2_dependency_check():
        # MySQL 8.4 defaults to caching_sha2_password. Newly created accounts
        # need PyMySQL's RSA backend on the isolated (non-TLS) Docker network.
        # Check this once rather than reporting five misleading connection errors.
        from cryptography.hazmat.primitives.asymmetric import padding
        return {"sha2_auth_backend_available": True}

    def writer_check():
        db = connect("writer")
        try:
            if _query(db, "SELECT 1") != ((1,),):
                raise RuntimeError("Writer query unexpectedly failed")
            return {"writer_authenticated": True}
        finally:
            db.close()

    def source_check():
        db = connect("replica")
        try:
            row = _query(db, "SELECT enabled FROM sim_control WHERE control_id=1")
            if len(row) != 1 or int(row[0][0]) != 0:
                raise RuntimeError("Unexpected simulation control state")
            return {"stopped": True}
        finally:
            db.close()

    def empty_check():
        db = connect("replica")
        try:
            # Only fixed synthetic table names are used.
            if any(_query(db, "SELECT 1 FROM " + table + " LIMIT 1")
                   for table in TABLES):
                raise RuntimeError("Non-empty synthetic source")
            return {"empty_source": True}
        finally:
            db.close()

    def binlog_check():
        db = connect("replica")
        try:
            mode = _query(db, "SELECT @@GLOBAL.log_bin, "
                               "@@GLOBAL.binlog_format, @@GLOBAL.binlog_row_image")
            if len(mode) != 1:
                raise RuntimeError("Binlog configuration unavailable")
            if (int(mode[0][0]) != 1 or str(mode[0][1]).upper() != "ROW"
                    or str(mode[0][2]).upper() != "FULL"):
                raise RuntimeError("Binlog configuration incompatible")
            return {"log_bin": True, "row_format": True, "full_image": True}
        finally:
            db.close()

    def binlog_status():
        db = connect("replica")
        try:
            rows = _query(db, "SHOW BINARY LOG STATUS")
            if not rows or not isinstance(rows[0][0], str):
                raise RuntimeError("No active binary-log status")
            return {"binlog_position_available": True}
        finally:
            db.close()

    def sink_check():
        db = connect("cdc")
        try:
            _query(db, "SELECT 1 FROM cdc_checkpoint LIMIT 1")
            return {"sink_checkpoint_accessible": True}
        finally:
            db.close()

    if not _stage("mysql_sha2_auth_backend", sha2_dependency_check):
        print(json.dumps({"local_cdc_preflight": "FAIL"}), flush=True)
        return 1

    result = all(([
        _stage("writer_authentication", writer_check),
        _stage("replica_connection_and_stop", source_check),
        _stage("source_empty", empty_check),
        _stage("row_binlog_configuration", binlog_check),
        _stage("binlog_status_privilege", binlog_status),
        _stage("analytics_sink_connection", sink_check),
    ]))
    print(json.dumps({"local_cdc_preflight": "PASS" if result else "FAIL"}), flush=True)
    return int(not result)


if __name__ == "__main__":
    sys.exit(main())
