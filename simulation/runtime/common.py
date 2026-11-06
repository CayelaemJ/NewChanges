"""Shared guarded MySQL connector. Always use dedicated simulation credentials."""
import os
from datetime import datetime, timezone

SOURCE_SCHEMA = "fixer_sim"
SINK_SCHEMA = "fixer_sim_analytics"


def utcnow():
    return datetime.now(timezone.utc).replace(tzinfo=None)


def positive_int(value, label, maximum):
    try:
        parsed = int(str(value))
    except (ValueError, TypeError) as exc:
        raise ValueError(f"Invalid {label}") from exc
    if not 1 <= parsed <= maximum:
        raise ValueError(f"{label} must be between 1 and {maximum}")
    return parsed


def connection_config(role="writer"):
    """No URL logging, no global admin users, TLS required away from local tests."""
    prefix = {"writer":"SIM_DB_", "cdc":"SIM_CDC_", "replica":"SIM_REPL_"}[role]
    host = os.environ.get(prefix + "HOST", "")
    user = os.environ.get(prefix + "USER", "")
    password = os.environ.get(prefix + "PASSWORD", "")
    target_db = SINK_SCHEMA if role == "cdc" else SOURCE_SCHEMA
    if not host or not user or not password or user.lower() in {"root", "admin", "master"}:
        raise RuntimeError("A dedicated, non-administrator MySQL credential is required")
    if os.environ.get(prefix + "DATABASE", "") != target_db:
        raise RuntimeError("Refusing connection outside the approved isolated schema")
    local = os.environ.get("SIM_ENV") == "local" and host in {"127.0.0.1", "localhost", "mysql"}
    ca = os.environ.get(prefix + "CA", "")
    if not local and not ca:
        raise RuntimeError("Verified TLS CA required for non-local MySQL connections")
    kwargs = dict(host=host, port=positive_int(os.environ.get(prefix + "PORT", "3306"), "port", 65535),
                  user=user, password=password, database=target_db, autocommit=False,
                  connect_timeout=5, read_timeout=15, write_timeout=15, charset="utf8mb4",
                  init_command="SET time_zone = '+00:00'")
    if not local:
        kwargs.update(ssl={"ca": ca}, ssl_verify_cert=True, ssl_verify_identity=True)
    return kwargs


def connect(role="writer"):
    import pymysql
    return pymysql.connect(**connection_config(role))


def redacted_error(exc):
    """Return type only. Driver messages may contain host, SQL, or secrets."""
    return type(exc).__name__
