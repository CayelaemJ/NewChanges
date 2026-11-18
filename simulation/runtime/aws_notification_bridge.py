"""Offline committed-transaction to notification-store bridge.

Accepts vetted row-event METADATA (no source row payloads). The future AWS
adapter must verify MySQL row-event types, real source transaction boundaries,
binlog coordinates, source identity and TLS before calling this bridge.
This module never opens a replication connection or touches RDS.
"""
from hashlib import sha256

from .aws_notification_contract import NotificationBaseline
from .aws_notification_sqlite import SqliteNotificationStore
from .ingest_stage_contract import FEED_TABLES
from .ingest_stage_txn import LogCoordinate, _cmp

OPS = frozenset({"WRITE_ROWS", "UPDATE_ROWS", "DELETE_ROWS"})


class NotificationTransactionBridge:
    def __init__(self, *, baseline, store, max_rows=1000):
        if not isinstance(baseline, NotificationBaseline):
            raise ValueError("Approved notification baseline required")
        if not isinstance(store, SqliteNotificationStore):
            raise ValueError("Explicit development notification store required")
        if type(max_rows) is not int or not 1 <= max_rows <= 10000:
            raise ValueError("Bounded transaction rows required")
        self.baseline = baseline
        self.store = store
        self.max_rows = max_rows
        self._clear()

    def _clear(self):
        self._pending = []
        self._last = None
        self._rows = 0

    @property
    def pending(self):
        return bool(self._pending)

    def abort(self):
        """Abort any in-progress source transaction; never advance checkpoint."""
        self._clear()

    def row(self, *, operation, schema, table, file, position, row_count):
        """Stage allowlisted row metadata; requires trusted upstream event parser."""
        try:
            if operation not in OPS or schema != "ingest_stage" or table not in FEED_TABLES:
                raise ValueError("Row event outside approved source allowlist")
            if type(row_count) is not int or row_count < 1:
                raise ValueError("Row event must have positive row count")
            coordinate = LogCoordinate(file, position)
            checkpoint = self.store.checkpoint(self.baseline.source_id)
            if _cmp(coordinate, checkpoint.coordinate) <= 0:
                raise ValueError("Row event is not after durable checkpoint")
            if self._last is not None and _cmp(coordinate, self._last) < 0:
                raise ValueError("Out-of-order source row event")
            if self._rows + row_count > self.max_rows:
                raise ValueError("Source transaction exceeds row limit")
            self._pending.append((operation, table, file, position, row_count))
            self._rows += row_count
            self._last = coordinate
            return self._rows
        except Exception:
            self.abort()
            raise

    def xid(self, *, file, position):
        """Durably commit invalidations only at an observed MySQL XID."""
        if not self._pending:
            return "IGNORED_NO_ALLOWLISTED_ROWS"
        try:
            coordinate = LogCoordinate(file, position)
            if _cmp(coordinate, self._last) <= 0:
                raise ValueError("XID is not after last source row event")
            previous = self.store.checkpoint(self.baseline.source_id)
            # The checksum contains binlog metadata only, never row data.
            details = "\\n".join(
                f"{op}:{table}:{name}:{pos}:{count}"
                for op, table, name, pos, count in self._pending
            )
            digest = sha256((
                f"{self.baseline.source_id}:{previous.file}:{previous.position}:"
                f"{file}:{position}\\n{details}"
            ).encode()).hexdigest()
            return self.store.commit(
                self.baseline, previous, coordinate,
                {table for _, table, _, _, _ in self._pending}, digest
            )
        finally:
            # On failure, discard in-memory transaction; caller must rewind
            # to the durable checkpoint and replay the source transaction.
            self.abort()
