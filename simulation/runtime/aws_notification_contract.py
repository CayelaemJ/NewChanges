"""Notification-only CDC contract (no DB connection, no AWS stream, no writes).

This does not reuse the state-replication SnapshotHandoff: reporting dashboards
requery the authoritative MySQL views and need only feed invalidations.
A baseline never claims that historical rows were snapshotted or copied.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
import re

from .ingest_stage_contract import FEED_TABLES
from .ingest_stage_txn import LogCoordinate, _cmp

_SOURCE = re.compile(r"^[a-z0-9][a-z0-9_-]{2,99}$")
_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_APPROVAL = "YES_NOTIFICATION_BASELINE_NO_HISTORICAL_COPY"


def source_contract_fingerprint():
    """Deterministic allowlist fingerprint; NOT a full MySQL DDL fingerprint."""
    return sha256(json.dumps({
        "schema": "ingest_stage", "physical_tables": sorted(FEED_TABLES),
        "primary_key": "_ingest_id", "contract_version": 1
    }, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


@dataclass(frozen=True)
class NotificationBaseline:
    """Explicit origin for an invalidation-only consumer, never a row snapshot."""

    source_id: str
    binlog_file: str
    binlog_position: int
    captured_at_utc: datetime
    source_fingerprint: str
    approval: str
    retention_hours: int

    def __post_init__(self):
        if not isinstance(self.source_id, str) or not _SOURCE.fullmatch(self.source_id):
            raise ValueError("Invalid source identity")
        LogCoordinate(self.binlog_file, self.binlog_position)
        if (not isinstance(self.captured_at_utc, datetime)
                or self.captured_at_utc.tzinfo is None):
            raise ValueError("Baseline capture time must have a timezone")
        if self.captured_at_utc.utcoffset().total_seconds() != 0:
            raise ValueError("Baseline timestamp must be UTC")
        if (not isinstance(self.source_fingerprint, str)
                or not _DIGEST.fullmatch(self.source_fingerprint)
                or self.source_fingerprint != source_contract_fingerprint()):
            raise ValueError("Source allowlist fingerprint mismatch")
        if self.approval != _APPROVAL:
            raise ValueError("Notification-only bootstrap requires explicit approval")
        if (type(self.retention_hours) is not int or self.retention_hours < 1
                or self.retention_hours > 168):
            raise ValueError("Unacceptable binlog retention")

    @property
    def coordinate(self):
        return LogCoordinate(self.binlog_file, self.binlog_position)


@dataclass(frozen=True)
class NotificationCheckpoint:
    """Last atomically persisted invalidation event boundary."""

    source_id: str
    file: str
    position: int
    generation: int

    def __post_init__(self):
        if not isinstance(self.source_id, str) or not _SOURCE.fullmatch(self.source_id):
            raise ValueError("Invalid checkpoint source")
        LogCoordinate(self.file, self.position)
        if type(self.generation) is not int or self.generation < 0:
            raise ValueError("Invalid generation counter")

    @property
    def coordinate(self):
        return LogCoordinate(self.file, self.position)


def validate_resume(baseline, checkpoint, *, binlog_files):
    """Fail closed when source identity changes or checkpoint log was purged.

    binlog_files must come from a fresh, authorized SHOW BINARY LOGS query,
    not from the caller's guessed current binlog position.
    """
    if not isinstance(baseline, NotificationBaseline):
        raise ValueError("Verified notification baseline required")
    if not isinstance(checkpoint, NotificationCheckpoint):
        raise ValueError("Durable notification checkpoint required")
    if checkpoint.source_id != baseline.source_id:
        raise ValueError("Source identity mismatch")
    if _cmp(checkpoint.coordinate, baseline.coordinate) < 0:
        raise ValueError("Checkpoint precedes the approved baseline")
    if (not isinstance(binlog_files, (tuple, list)) or not binlog_files
            or any(not isinstance(name, str) for name in binlog_files)):
        raise ValueError("Fresh binlog inventory required")
    if checkpoint.file not in binlog_files:
        raise ValueError("Checkpoint log is missing or purged; reconciliation required")
    for name in binlog_files:
        _cmp(LogCoordinate(name, 4), baseline.coordinate)
    return checkpoint.coordinate


def select_affected_feeds(observed_tables):
    """Reject unknown physical tables; no silent routing or source-row access."""
    if not isinstance(observed_tables, (set, frozenset, tuple, list)):
        raise ValueError("Source table inventory required")
    tables = set()
    for name in observed_tables:
        if not isinstance(name, str) or name not in FEED_TABLES:
            raise ValueError("CDC physical table outside approved allowlist")
        tables.add(name)
    return tuple(sorted(tables))
