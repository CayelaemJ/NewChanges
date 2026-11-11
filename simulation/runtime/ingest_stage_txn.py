"""Offline-only transaction and checkpoint planner for the ingest_stage CDC pipeline.

No MySQL access, source row persistence, or activation. A real worker must
observe XID/COMMIT and atomically persist source markers with checkpoint.
"""
from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
import re

_ALLOWED = frozenset({
    "employers", "workforce_snapshots", "employees", "platform_users",
    "journeys", "debt_accounts", "policies", "ratings", "referrals",
    "salary_advances",
})
_FILE = re.compile(r"^([A-Za-z][A-Za-z0-9_-]{0,95})\.(\d{6,12})$")
_HEX = re.compile(r"^[0-9a-f]{64}$")


@dataclass(frozen=True)
class LogCoordinate:
    file: str
    position: int

    def __post_init__(self):
        if not isinstance(self.file, str) or _FILE.fullmatch(self.file) is None:
            raise ValueError("Unsupported binlog filename")
        if isinstance(self.position, bool) or not isinstance(self.position, int) or self.position < 4:
            raise ValueError("Invalid binlog position")

    def rank(self):
        match = _FILE.fullmatch(self.file)
        return match.group(1), int(match.group(2)), self.position


def _cmp(left, right):
    if not isinstance(left, LogCoordinate) or not isinstance(right, LogCoordinate):
        raise ValueError("Checkpoint coordinate required")
    a, b = left.rank(), right.rank()
    if a[0] != b[0]:
        raise ValueError("Binlog lineage changed; new snapshot required")
    return (a[1:] > b[1:]) - (a[1:] < b[1:])


@dataclass(frozen=True)
class OpaqueChange:
    feed: str
    operation: str
    event_key: str
    opaque_row_key: str
    needs_tombstone: bool
    source_timestamp_state: str
    binlog_event_at_utc: datetime
    captured_at_utc: datetime

    @classmethod
    def from_marker(cls, marker):
        """Copy only approved marker fields, never retain the source row image."""
        if getattr(marker, "feed", None) not in _ALLOWED:
            raise ValueError("Feed not allowlisted")
        op = getattr(marker, "operation", None)
        if op not in {"INSERT", "UPDATE", "DELETE"}:
            raise ValueError("Operation not allowlisted")
        event = getattr(marker, "event_key", None)
        row = getattr(marker, "opaque_row_key", None)
        if not isinstance(event, str) or _HEX.fullmatch(event) is None:
            raise ValueError("Event identity invalid")
        if not isinstance(row, str) or _HEX.fullmatch(row) is None:
            raise ValueError("Opaque row identity invalid")
        tombstone = getattr(marker, "needs_tombstone", None)
        if type(tombstone) is not bool or tombstone != (op == "DELETE"):
            raise ValueError("Tombstone does not match operation")
        state = getattr(marker, "source_timestamp_state", None)
        if state not in {"DELETED_NO_LIVE_WATERMARK", "MISSING_SOURCE_WATERMARK",
                         "INSERT_TIMESTAMP_UNVERIFIED", "NOT_ADVANCED_ON_UPDATE",
                         "CHANGED_BUT_UNVERIFIED"}:
            raise ValueError("Unrecognized source timestamp state")
        for field in ("binlog_event_at_utc", "captured_at_utc"):
            timestamp = getattr(marker, field, None)
            if not isinstance(timestamp, datetime) or timestamp.tzinfo is None:
                raise ValueError("Marker timestamp must be aware")
        return cls(marker.feed, op, event, row, tombstone, state,
                   marker.binlog_event_at_utc.astimezone(timezone.utc),
                   marker.captured_at_utc.astimezone(timezone.utc))


@dataclass(frozen=True)
class CommitPlan:
    """Proposed atomic sink write, not evidence that one has occurred."""
    previous: LogCoordinate
    next_checkpoint: LogCoordinate
    changes: tuple
    digest: str


class TransactionPlanner:
    """Only one in-flight transaction; no checkpoint before durable ACK."""

    def __init__(self, checkpoint, *, max_rows=500):
        if not isinstance(checkpoint, LogCoordinate):
            raise ValueError("Verified initial checkpoint required")
        if isinstance(max_rows, bool) or not isinstance(max_rows, int) or not 1 <= max_rows <= 1000:
            raise ValueError("Invalid transaction row limit")
        self.checkpoint = checkpoint
        self.max_rows = max_rows
        self._active = False
        self._pending = []
        self._seen = set()
        self._last = checkpoint
        self._prepared = None

    def begin(self):
        if self._active or self._prepared is not None:
            raise RuntimeError("Another transaction is unfinished")
        self._pending = []
        self._seen = set()
        self._last = self.checkpoint
        self._active = True

    def stage(self, marker, event_coordinate):
        if not self._active or self._prepared is not None:
            raise RuntimeError("Transaction not accepting events")
        if _cmp(event_coordinate, self.checkpoint) <= 0 or _cmp(event_coordinate, self._last) < 0:
            raise ValueError("Stale or out-of-order source event")
        if len(self._pending) >= self.max_rows:
            raise RuntimeError("Source transaction exceeded safe row cap; abort without checkpoint")
        change = OpaqueChange.from_marker(marker)
        if change.event_key in self._seen:
            raise ValueError("Duplicate row event within source transaction")
        self._seen.add(change.event_key)
        self._pending.append(change)
        self._last = event_coordinate

    def prepare_commit(self, commit_coordinate):
        if not self._active or self._prepared is not None:
            raise RuntimeError("No unprepared source transaction")
        if _cmp(commit_coordinate, self.checkpoint) <= 0 or _cmp(commit_coordinate, self._last) <= 0:
            raise ValueError("Invalid source COMMIT boundary")
        changes = tuple(self._pending)
        digest = sha256((self.checkpoint.file + ":" + str(self.checkpoint.position) +
                         ":" + commit_coordinate.file + ":" + str(commit_coordinate.position) +
                         ":" + ":".join(m.event_key for m in changes)).encode()).hexdigest()
        self._prepared = CommitPlan(self.checkpoint, commit_coordinate, changes, digest)
        self._active = False
        return self._prepared

    def confirm_durable_commit(self, persisted_plan):
        """Call ONLY after sink markers and checkpoint are atomically committed.

        The planner cannot verify external durability: the sink must enforce it.
        """
        if self._prepared is None or persisted_plan is not self._prepared:
            raise RuntimeError("Refusing unverified or mismatched durable commit")
        self.checkpoint = self._prepared.next_checkpoint
        self._prepared = None
        self._pending = []
        self._seen = set()
        self._last = self.checkpoint

    def abort(self):
        """Discard pending markers without changing the source checkpoint."""
        self._active = False
        self._prepared = None
        self._pending = []
        self._seen = set()
        self._last = self.checkpoint
