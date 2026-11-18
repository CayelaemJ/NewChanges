"""Development-only, durable SQLite notification checkpoint store.

Not a live AWS worker, not a production multi-host coordination system.
Uses a single SQLite transaction for feed generations and committed position.
Never saves MySQL row images, primary keys or other PII.
"""
import json
from contextlib import contextmanager
import sqlite3
from pathlib import Path

from .aws_notification_contract import (
    NotificationBaseline, NotificationCheckpoint, select_affected_feeds,
)
from .ingest_stage_contract import FEED_TABLES
from .ingest_stage_txn import LogCoordinate, _cmp

_SCHEMA = """
CREATE TABLE IF NOT EXISTS cdc_baseline (
    source_id TEXT PRIMARY KEY,
    file TEXT NOT NULL,
    position INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    approval TEXT NOT NULL,
    retained_hours INTEGER NOT NULL,
    captured_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cdc_checkpoint (
    source_id TEXT PRIMARY KEY REFERENCES cdc_baseline(source_id),
    file TEXT NOT NULL,
    position INTEGER NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 0)
);
CREATE TABLE IF NOT EXISTS cdc_feed_generation (
    source_id TEXT NOT NULL,
    feed TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK (generation >= 0),
    PRIMARY KEY (source_id, feed)
);
CREATE TABLE IF NOT EXISTS cdc_commit_digest (
    source_id TEXT NOT NULL,
    file TEXT NOT NULL,
    position INTEGER NOT NULL,
    digest TEXT NOT NULL,
    PRIMARY KEY (source_id, file, position)
);
"""


class SqliteNotificationStore:
    """Offline development reference store for one SQLite DB file.

    A production deploy MUST use an approved durable shared store + leader
    lease, backups, encrypted storage, and credentials outside source control.
    """

    def __init__(self, path):
        if not isinstance(path, (str, Path)) or str(path) in ("", ":memory:"):
            raise ValueError("Persistent SQLite file path required")
        self.path = str(path)

    @contextmanager
    def _connect(self):
        """Close each connection after use, including failed transactions.

        sqlite3.Connection.__exit__ handles transaction state but does NOT
        close its file descriptor. This wrapper prevents SQLite connections
        leaking across the full host/Docker unittest suite.
        """
        conn = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        try:
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=10000")
            conn.execute("PRAGMA synchronous=FULL")
            conn.executescript(_SCHEMA)
            yield conn
        finally:
            conn.close()

    def bootstrap(self, baseline):
        if not isinstance(baseline, NotificationBaseline):
            raise ValueError("Approved notification baseline required")
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                existing = conn.execute(
                    "SELECT file,position,fingerprint,approval,retained_hours,captured_at "
                    "FROM cdc_baseline WHERE source_id=?", (baseline.source_id,)
                ).fetchone()
                expected = (
                    baseline.binlog_file, baseline.binlog_position,
                    baseline.source_fingerprint, baseline.approval,
                    baseline.retention_hours, baseline.captured_at_utc.isoformat()
                )
                if existing is not None:
                    if existing != expected:
                        raise ValueError("Existing baseline mismatch: refusing rebootstrap")
                    conn.commit()
                    return "ALREADY_BOOTSTRAPPED"
                conn.execute(
                    "INSERT INTO cdc_baseline VALUES(?,?,?,?,?,?,?)",
                    (baseline.source_id, *expected)
                )
                conn.execute(
                    "INSERT INTO cdc_checkpoint VALUES(?,?,?,?)",
                    (baseline.source_id, baseline.binlog_file, baseline.binlog_position, 0)
                )
                conn.executemany(
                    "INSERT INTO cdc_feed_generation VALUES(?,?,0)",
                    [(baseline.source_id, feed) for feed in sorted(FEED_TABLES)]
                )
                conn.commit()
                return "BOOTSTRAPPED"
            except Exception:
                conn.rollback()
                raise

    def checkpoint(self, source_id):
        with self._connect() as conn:
            row = conn.execute(
                "SELECT file,position,generation FROM cdc_checkpoint WHERE source_id=?",
                (source_id,)
            ).fetchone()
        if row is None:
            raise ValueError("Missing persisted CDC baseline")
        return NotificationCheckpoint(source_id, row[0], row[1], row[2])

    def generations(self, source_id):
        with self._connect() as conn:
            rows = conn.execute(
                "SELECT feed,generation FROM cdc_feed_generation WHERE source_id=?",
                (source_id,)
            ).fetchall()
        if len(rows) != len(FEED_TABLES):
            raise ValueError("Incomplete feed generation inventory")
        return dict(rows)

    def commit(self, baseline, previous, next_coordinate, feeds, digest):
        """Atomically publish invalidations + checkpoint for an XID commit.

        The caller MUST establish source XID/commit and verify binlog lineage,
        retention availability, and source identity before invoking this method.
        No relay/stream is implemented here.
        """
        if not isinstance(baseline, NotificationBaseline):
            raise ValueError("Approved baseline required")
        if not isinstance(previous, NotificationCheckpoint):
            raise ValueError("Persisted checkpoint required")
        if previous.source_id != baseline.source_id:
            raise ValueError("Checkpoint source mismatch")
        if not isinstance(next_coordinate, LogCoordinate):
            raise ValueError("Committed source coordinate required")
        if _cmp(next_coordinate, previous.coordinate) <= 0:
            raise ValueError("Committed position must advance")
        if not isinstance(digest, str) or len(digest) != 64 or any(
            ch not in "0123456789abcdef" for ch in digest
        ):
            raise ValueError("SHA-256 commit digest required")
        selected = select_affected_feeds(feeds)
        if not selected:
            raise ValueError("A committed allowlisted source change is required")
        with self._connect() as conn:
            conn.execute("BEGIN IMMEDIATE")
            try:
                stored = conn.execute(
                    "SELECT file,position,fingerprint,approval,retained_hours,captured_at "
                    "FROM cdc_baseline WHERE source_id=?", (baseline.source_id,)
                ).fetchone()
                if stored != (
                    baseline.binlog_file,baseline.binlog_position,
                    baseline.source_fingerprint,baseline.approval,
                    baseline.retention_hours,baseline.captured_at_utc.isoformat()
                ):
                    raise ValueError("Stored source baseline mismatch")
                current = conn.execute(
                    "SELECT file,position,generation FROM cdc_checkpoint "
                    "WHERE source_id=?", (baseline.source_id,)
                ).fetchone()
                if current is None:
                    raise ValueError("Missing checkpoint")
                target = (next_coordinate.file, next_coordinate.position)
                prior_digest = conn.execute(
                    "SELECT digest FROM cdc_commit_digest "
                    "WHERE source_id=? AND file=? AND position=?",
                    (baseline.source_id,*target)
                ).fetchone()
                if prior_digest:
                    if prior_digest[0] != digest:
                        raise ValueError("Conflicting replay digest")
                    conn.rollback()
                    return "REPLAYED"
                if current != (
                    previous.file, previous.position, previous.generation
                ):
                    raise ValueError("Stale checkpoint: optimistic guard rejected")
                conn.execute(
                    "INSERT INTO cdc_commit_digest VALUES(?,?,?,?)",
                    (baseline.source_id,*target,digest)
                )
                conn.executemany(
                    "UPDATE cdc_feed_generation SET generation=generation+1 "
                    "WHERE source_id=? AND feed=?",
                    [(baseline.source_id,feed) for feed in selected]
                )
                changed = conn.execute(
                    "UPDATE cdc_checkpoint SET file=?, position=?,generation=generation+1 "
                    "WHERE source_id=? AND file=? AND position=? AND generation=?",
                    (next_coordinate.file,next_coordinate.position,baseline.source_id,
                     previous.file,previous.position,previous.generation)
                ).rowcount
                if changed != 1:
                    raise RuntimeError("Checkpoint CAS failed")
                conn.commit()
                return "PERSISTED"
            except Exception:
                conn.rollback()
                raise
