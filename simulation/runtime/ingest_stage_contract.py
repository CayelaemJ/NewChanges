"""Pure, OFFLINE change-marker contract for the existing ingest_stage source.

This module has no database connection, no binlog reader and no persistence.
It deliberately does NOT enable live CDC or convert a source business timestamp
into an artificial 'updated_at'. Replication access must be approved separately.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import hmac
import re

SOURCE_SCHEMA = "ingest_stage"
SOURCE_PK = "_ingest_id"
# Import manifests are control metadata, not a canonical dashboard feed.
FEED_TABLES = frozenset({
    "employers", "workforce_snapshots", "employees", "platform_users",
    "journeys", "debt_accounts", "policies", "ratings", "referrals",
    "salary_advances",
})
OPS = frozenset({"INSERT", "UPDATE", "DELETE"})
_BINLOG_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


@dataclass(frozen=True)
class ChangeMarker:
    """Metadata only. NO raw source row, payroll/debt details or source PK."""

    feed: str
    operation: str
    event_key: str
    opaque_row_key: str
    binlog_event_at_utc: datetime
    captured_at_utc: datetime
    source_timestamp_state: str
    needs_tombstone: bool


def _key(row):
    if not isinstance(row, dict):
        raise ValueError("CDC row image is required")
    pk = row.get(SOURCE_PK)
    if isinstance(pk, bool) or not isinstance(pk, (str, int)):
        raise ValueError("CDC row has no usable source primary key")
    if isinstance(pk, int):
        if pk <= 0:
            raise ValueError("CDC row has no usable source primary key")
        return str(pk)
    if not pk or len(pk) > 128 or pk.strip() != pk:
        raise ValueError("CDC row has no usable source primary key")
    return pk


def make_change_marker(*, schema, table, operation, old, new, binlog_file,
                       binlog_position, row_index, binlog_timestamp,
                       hmac_secret, captured_at_utc=None):
    """Validate an allowlisted row-binlog event without retaining its contents.

    The MySQL binlog event time has SECOND precision. The capture clock is an
    independent processing timestamp and does not fix a stale source cursor.
    """
    if schema != SOURCE_SCHEMA or not isinstance(table, str) or table not in FEED_TABLES or operation not in OPS:
        raise ValueError("CDC schema, table or operation not allowlisted")
    if not isinstance(hmac_secret, bytes) or len(hmac_secret) < 32:
        raise ValueError("A dedicated 32-byte-or-longer CDC HMAC key is required")
    if not isinstance(binlog_file, str) or not _BINLOG_NAME.fullmatch(binlog_file):
        raise ValueError("Invalid binlog coordinate")
    if (isinstance(binlog_position, bool) or not isinstance(binlog_position, int)
            or binlog_position < 4 or isinstance(row_index, bool)
            or not isinstance(row_index, int) or row_index < 0):
        raise ValueError("Invalid binlog coordinate")
    if isinstance(binlog_timestamp, bool) or not isinstance(binlog_timestamp, int) or binlog_timestamp <= 0:
        raise ValueError("Invalid binlog event timestamp")
    try:
        event_at = datetime.fromtimestamp(binlog_timestamp, tz=timezone.utc)
    except (ValueError, OverflowError, OSError) as exc:
        raise ValueError("Invalid binlog event timestamp") from exc

    if operation == "INSERT":
        if old is not None or not isinstance(new, dict):
            raise ValueError("Invalid INSERT row image")
        row = new
    elif operation == "DELETE":
        if new is not None or not isinstance(old, dict):
            raise ValueError("Invalid DELETE row image")
        row = old
    else:
        if not isinstance(old, dict) or not isinstance(new, dict):
            raise ValueError("UPDATE requires full before/after row images")
        if _key(old) != _key(new):
            raise ValueError("UPDATE changed source primary key")
        row = new

    pk = _key(row)
    captured_at = captured_at_utc or datetime.now(timezone.utc)
    if not isinstance(captured_at, datetime) or captured_at.tzinfo is None:
        raise ValueError("CDC capture timestamp must be timezone-aware")
    captured_at = captured_at.astimezone(timezone.utc)

    if operation == "DELETE":
        timestamp_state = "DELETED_NO_LIVE_WATERMARK"
    elif not new.get("source_updated_at"):
        timestamp_state = "MISSING_SOURCE_WATERMARK"
    elif operation == "INSERT":
        timestamp_state = "INSERT_TIMESTAMP_UNVERIFIED"
    elif old.get("source_updated_at") == new.get("source_updated_at"):
        timestamp_state = "NOT_ADVANCED_ON_UPDATE"
    else:
        timestamp_state = "CHANGED_BUT_UNVERIFIED"

    # Stable event key from binlog coordinates; opaque row key scoped by source
    # schema AND table. Neither output contains the raw primary key or PII.
    event_key = sha256(f"{binlog_file}:{binlog_position}:{row_index}:{table}".encode()).hexdigest()
    pk_token = hmac.new(hmac_secret, f"{SOURCE_SCHEMA}:{table}:{pk}".encode(), sha256).hexdigest()
    return ChangeMarker(
        feed=table, operation=operation, event_key=event_key,
        opaque_row_key=pk_token, binlog_event_at_utc=event_at,
        captured_at_utc=captured_at, source_timestamp_state=timestamp_state,
        needs_tombstone=(operation == "DELETE"),
    )


@dataclass(frozen=True)
class SnapshotHandoff:
    """Offline proof object. Not evidence that a remote snapshot was run."""

    schema: str
    binlog_file: str
    binlog_position: int
    snapshot_consistent: bool
    snapshot_import_verified: bool
    snapshot_manifest_sha256: str
    retention_hours: int


def validate_snapshot_handoff(proof):
    """Never start an existing/nonempty source at today's binlog position."""
    if not isinstance(proof, SnapshotHandoff) or proof.schema != SOURCE_SCHEMA:
        raise ValueError("Source snapshot handoff is not verified")
    if proof.snapshot_consistent is not True or proof.snapshot_import_verified is not True:
        raise ValueError("Source snapshot handoff is not verified")
    if (not isinstance(proof.snapshot_manifest_sha256, str)
            or not re.fullmatch(r"[0-9a-f]{64}", proof.snapshot_manifest_sha256)):
        raise ValueError("Source snapshot manifest is not verified")
    if (not isinstance(proof.binlog_file, str)
            or not _BINLOG_NAME.fullmatch(proof.binlog_file)
            or isinstance(proof.binlog_position, bool)
            or not isinstance(proof.binlog_position, int)
            or proof.binlog_position < 4):
        raise ValueError("Source snapshot checkpoint is not verified")
    if (isinstance(proof.retention_hours, bool) or not isinstance(proof.retention_hours, int)
            or proof.retention_hours <= 0):
        raise ValueError("CDC binlog retention is unconfigured")
    return True
