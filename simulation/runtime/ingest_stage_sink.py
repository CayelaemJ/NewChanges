"""Local-only MySQL durable sink for opaque ingest_stage CDC metadata.

Not a live AWS reader. Never writes to ingest_stage or stores source row images.
The same InnoDB transaction persists event markers and the binlog checkpoint.
"""
import os
import re
from datetime import timezone
from hashlib import sha256

from .ingest_stage_contract import validate_snapshot_handoff
from .ingest_stage_txn import CommitPlan, LogCoordinate, OpaqueChange, _cmp

CONSUMER = "ingest-stage-local-pilot-v1"
_DIGEST = re.compile(r"^[0-9a-f]{64}$")


def _require_local():
    if not (os.environ.get("SIM_ENV") == "local"
            and os.environ.get("RUN_LOCAL_MYSQL_TESTS") == "yes"
            and os.environ.get("SIM_DB_HOST") == "mysql"
            and os.environ.get("SIM_CDC_HOST") == "mysql"):
        raise RuntimeError("ingest_stage CDC sink requires disposable local MySQL")


def _consumer(name):
    if not isinstance(name, str) or re.fullmatch(r"[a-z0-9][a-z0-9-]{0,59}", name) is None:
        raise ValueError("Invalid CDC consumer name")
    return name


def _execute(db, sql, args=()):
    with db.cursor() as cursor:
        count = cursor.execute(sql, args)
        return count, cursor.fetchall() if cursor.description is not None else ()


def _datetime(value):
    return value.astimezone(timezone.utc).replace(tzinfo=None)


def _plan_checksum(plan):
    return sha256((
        plan.previous.file + ":" + str(plan.previous.position) + ":" +
        plan.next_checkpoint.file + ":" + str(plan.next_checkpoint.position) +
        ":" + ":".join(change.event_key for change in plan.changes)
    ).encode()).hexdigest()


def bootstrap_local_sink(db, handoff, *, consumer_name=CONSUMER):
    """Initialize ONLY a new disposable sink after a validated snapshot gate.

    The proof flags are assertions from the caller, not independent evidence
    that a real snapshot was taken. This API is disabled outside Docker.
    """
    _require_local()
    name = _consumer(consumer_name)
    validate_snapshot_handoff(handoff)
    db.begin()
    try:
        _, rows = _execute(db, """SELECT log_file,log_pos,snapshot_manifest_sha256
            FROM fixer_ingest_cdc.ingest_checkpoint
            WHERE consumer_name=%s FOR UPDATE""", (name,))
        if rows:
            if tuple(rows[0]) != (
                handoff.binlog_file, handoff.binlog_position, handoff.snapshot_manifest_sha256
            ):
                raise ValueError("Existing checkpoint does not match snapshot handoff")
            db.rollback()
            return "ALREADY_BOOTSTRAPPED"
        _execute(db, """INSERT INTO fixer_ingest_cdc.ingest_checkpoint
            (consumer_name,log_file,log_pos,snapshot_manifest_sha256,last_plan_digest)
            VALUES(%s,%s,%s,%s,%s)""",
            (name, handoff.binlog_file, handoff.binlog_position,
             handoff.snapshot_manifest_sha256, "0" * 64))
        db.commit()
        return "BOOTSTRAPPED"
    except Exception:
        db.rollback()
        raise



def load_local_checkpoint(db, handoff, *, consumer_name=CONSUMER):
    """Read the last atomically committed position without a new bootstrap.

    The snapshot manifest must match the original immutable handoff. This is
    a LOCAL PILOT proof only; the caller must independently establish real
    snapshot consistency and binlog availability before any future cutover.
    A fresh read transaction prevents a stale REPEATABLE READ cursor.
    """
    _require_local()
    name = _consumer(consumer_name)
    validate_snapshot_handoff(handoff)
    db.rollback()
    try:
        _, rows = _execute(db, """SELECT log_file,log_pos,
            snapshot_manifest_sha256,last_plan_digest
            FROM fixer_ingest_cdc.ingest_checkpoint
            WHERE consumer_name=%s""", (name,))
    finally:
        db.rollback()
    if len(rows) != 1:
        raise ValueError("Missing durable CDC checkpoint; snapshot bootstrap required")
    file, position, manifest, digest = rows[0]
    if manifest != handoff.snapshot_manifest_sha256:
        raise ValueError("Stored checkpoint belongs to a different source snapshot")
    if not isinstance(digest, str) or _DIGEST.fullmatch(digest) is None:
        raise ValueError("Stored checkpoint digest is malformed")
    recovered = LogCoordinate(file, position)
    original = LogCoordinate(handoff.binlog_file, handoff.binlog_position)
    if _cmp(recovered, original) < 0:
        raise ValueError("Stored checkpoint predates verified source snapshot")
    return recovered


def persist_local_plan(db, plan, *, consumer_name=CONSUMER):
    """Atomically write all metadata markers and the checkpoint, or neither.

    Returns PERSISTED or REPLAYED. Only then may the calling planner invoke
    confirm_durable_commit(plan). A failed write always rolls back.
    """
    _require_local()
    name = _consumer(consumer_name)
    if not isinstance(plan, CommitPlan) or not isinstance(plan.previous, LogCoordinate):
        raise ValueError("Invalid source transaction plan")
    if not isinstance(plan.next_checkpoint, LogCoordinate):
        raise ValueError("Invalid source transaction checkpoint")
    if not isinstance(plan.changes, tuple) or len(plan.changes) > 1000:
        raise ValueError("Unsafe CDC transaction length")
    if _cmp(plan.next_checkpoint, plan.previous) <= 0:
        raise ValueError("Source checkpoint must advance beyond the previous commit")
    # Validate the marker *before* digesting it, including source privacy,
    # allowed operations, opaque HMAC identifiers and aware UTC timestamps.
    if not all(isinstance(change, OpaqueChange) for change in plan.changes):
        raise ValueError("Raw source row payload rejected")
    for change in plan.changes:
        OpaqueChange.from_marker(change)
    if (not isinstance(plan.digest, str) or _DIGEST.fullmatch(plan.digest) is None
            or plan.digest != _plan_checksum(plan)):
        raise ValueError("Invalid source transaction digest")
    db.begin()
    try:
        _, rows = _execute(db, """SELECT log_file,log_pos,last_plan_digest
            FROM fixer_ingest_cdc.ingest_checkpoint
            WHERE consumer_name=%s FOR UPDATE""", (name,))
        if len(rows) != 1:
            raise ValueError("Missing verified CDC sink bootstrap")
        file, pos, latest_digest = rows[0]
        if (file, pos) == (
            plan.next_checkpoint.file, plan.next_checkpoint.position
        ) and latest_digest == plan.digest:
            db.rollback()
            return "REPLAYED"
        if (file, pos) != (plan.previous.file, plan.previous.position):
            raise ValueError("CDC checkpoint changed; resnapshot/reload required")

        feed_notices = {}
        for change in plan.changes:
            _execute(db, """INSERT INTO fixer_ingest_cdc.ingest_change_markers
                (event_key,feed,operation,opaque_row_key,source_timestamp_state,
                 needs_tombstone,binlog_event_at_utc,captured_at_utc)
                VALUES(%s,%s,%s,%s,%s,%s,%s,%s)""",
                (change.event_key, change.feed, change.operation,
                 change.opaque_row_key, change.source_timestamp_state,
                 int(change.needs_tombstone),
                 _datetime(change.binlog_event_at_utc),
                 _datetime(change.captured_at_utc)))
            prev = feed_notices.get(change.feed)
            if prev is None or change.captured_at_utc >= prev.captured_at_utc:
                feed_notices[change.feed] = change
        for feed, last in feed_notices.items():
            _execute(db, """INSERT INTO fixer_ingest_cdc.ingest_feed_notifications
                (feed,generation,last_captured_at_utc,last_event_key)
                VALUES(%s,1,%s,%s)
                ON DUPLICATE KEY UPDATE generation=generation+1,
                last_captured_at_utc=GREATEST(last_captured_at_utc,VALUES(last_captured_at_utc)),
                last_event_key=VALUES(last_event_key)""",
                (feed,_datetime(last.captured_at_utc),last.event_key))

        affected, _ = _execute(db, """UPDATE fixer_ingest_cdc.ingest_checkpoint
            SET log_file=%s,log_pos=%s,last_plan_digest=%s,updated_at=UTC_TIMESTAMP(6)
            WHERE consumer_name=%s AND log_file=%s AND log_pos=%s""",
            (plan.next_checkpoint.file,plan.next_checkpoint.position,plan.digest,
             name,plan.previous.file,plan.previous.position))
        if affected != 1:
            raise RuntimeError("CDC checkpoint lost optimistic safety guard")
        db.commit()
        return "PERSISTED"
    except Exception:
        db.rollback()
        raise
