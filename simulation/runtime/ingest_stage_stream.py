"""Isolated ingest_stage binlog-to-sink bridge, NEVER a live RDS worker.

A row event is only proposed until the corresponding MySQL XID commits.
The bridge deliberately ignores commits with no allowlisted source rows;
otherwise writing its own sink would trigger an endless empty-XID loop.
"""
import time

from .ingest_stage_contract import validate_snapshot_handoff
from .ingest_stage_row_adapter import stage_row_event
from .ingest_stage_sink import _require_local, persist_local_plan
from .ingest_stage_txn import LogCoordinate, TransactionPlanner

_ROWS = frozenset({"WRITE_ROWS", "UPDATE_ROWS", "DELETE_ROWS"})


class LocalIngestBridge:
    """Pure event dispatcher; sink writer is injected for testability."""

    def __init__(self, planner, *, hmac_secret, persist):
        if not isinstance(planner, TransactionPlanner):
            raise ValueError("Source transaction planner required")
        if not isinstance(hmac_secret, bytes) or len(hmac_secret) < 32:
            raise ValueError("Dedicated 32-byte+ HMAC secret required")
        if not callable(persist):
            raise ValueError("Atomic durable sink writer required")
        self.planner = planner
        self._secret = hmac_secret
        self._persist = persist
        self._open = False
        self.commits = 0
        self.marker_count = 0

    def accept(self, kind, event, *, binlog_file):
        """Consume row envelopes or an explicit XID COMMIT; never read payloads to logs.

        A bad record, unexpected event, failed sink write or missing commit
        aborts the in-memory batch without moving the checkpoint.
        """
        try:
            if kind in _ROWS:
                if not self._open:
                    self.planner.begin()
                    self._open = True
                return stage_row_event(
                    self.planner, kind=kind, event=event,
                    binlog_file=binlog_file, hmac_secret=self._secret,
                )
            if kind == "XID":
                if not self._open:
                    # Foreign-schema and sink-only transactions. Do not
                    # create an empty checkpoint write in response!
                    return "IGNORED_NO_SOURCE_ROWS"
                coordinate = LogCoordinate(
                    binlog_file, getattr(getattr(event, "packet", None), "log_pos", None)
                )
                plan = self.planner.prepare_commit(coordinate)
                result = self._persist(plan)
                if result not in {"PERSISTED", "REPLAYED"}:
                    raise RuntimeError("CDC sink did not acknowledge durable commit")
                self.planner.confirm_durable_commit(plan)
                self._open = False
                self.commits += 1
                self.marker_count += len(plan.changes)
                return result
            raise ValueError("Unexpected binlog event; refusing to skip transaction boundary")
        except Exception:
            self.abort()
            raise

    def abort(self):
        self.planner.abort()
        self._open = False


def run_local_binlog(*, sink_db, handoff, hmac_secret, consumer_name,
                     max_commits=5, max_packets=1000, max_seconds=15):
    """Consume a bounded local MySQL stream, with explicit XID boundaries.

    No production connector, no background process, no automatic bootstrap.
    The caller must have bootstrapped an EMPTY LOCAL source snapshot and sink.
    """
    _require_local()
    import os
    if os.environ.get("SIM_REPL_HOST") != "mysql":
        raise RuntimeError("Local ingest CDC bridge refuses a non-Docker replica host")
    validate_snapshot_handoff(handoff)
    if (not isinstance(max_commits, int) or isinstance(max_commits, bool)
            or not 1 <= max_commits <= 25
            or not isinstance(max_packets, int) or isinstance(max_packets, bool)
            or not 1 <= max_packets <= 5000
            or not isinstance(max_seconds, (int, float)) or isinstance(max_seconds, bool)
            or not 0 < max_seconds <= 120):
        raise ValueError("Local CDC work limits invalid")

    from pymysqlreplication import BinLogStreamReader
    from pymysqlreplication.event import XidEvent
    from pymysqlreplication.row_event import WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent
    from .common import connection_config

    # Do not silently skip data by using today's coordinates. The supplied
    # approved LOCAL empty-source snapshot must match an existing sink record.
    with sink_db.cursor() as cur:
        cur.execute("""SELECT log_file,log_pos,snapshot_manifest_sha256
            FROM fixer_ingest_cdc.ingest_checkpoint
            WHERE consumer_name=%s""", (consumer_name,))
        row = cur.fetchone()
    sink_db.rollback()
    if tuple(row or ()) != (
        handoff.binlog_file, handoff.binlog_position,
        handoff.snapshot_manifest_sha256,
    ):
        raise RuntimeError("Local snapshot and durable checkpoint do not match")

    planner = TransactionPlanner(
        LogCoordinate(handoff.binlog_file, handoff.binlog_position),
        handoff=handoff,
    )
    bridge = LocalIngestBridge(
        planner, hmac_secret=hmac_secret,
        persist=lambda plan: persist_local_plan(sink_db, plan, consumer_name=consumer_name),
    )
    config = connection_config("replica")
    stream = None
    packets = 0
    start = time.monotonic()
    try:
        stream = BinLogStreamReader(
            connection_settings=config,
            server_id=24135,
            only_schemas=["ingest_stage"],
            only_tables=["employees", "debt_accounts"],
            only_events=[WriteRowsEvent, UpdateRowsEvent, DeleteRowsEvent, XidEvent],
            blocking=False, resume_stream=True,
            log_file=handoff.binlog_file, log_pos=handoff.binlog_position,
            freeze_schema=True,
        )
        for event in stream:
            packets += 1
            if packets > max_packets or time.monotonic() - start > max_seconds:
                raise RuntimeError("Local CDC processing limit reached")
            kind = (
                "WRITE_ROWS" if isinstance(event, WriteRowsEvent)
                else "UPDATE_ROWS" if isinstance(event, UpdateRowsEvent)
                else "DELETE_ROWS" if isinstance(event, DeleteRowsEvent)
                else "XID" if isinstance(event, XidEvent)
                else None
            )
            if kind is None:
                raise RuntimeError("Unknown MySQL binlog event")
            bridge.accept(kind, event, binlog_file=stream.log_file)
            if bridge.commits >= max_commits:
                break
        if bridge._open:
            # Nonblocking EOF may be in the middle of a source transaction.
            # Safe response is to roll back and read again from durable point.
            raise RuntimeError("Incomplete source transaction: no XID yet")
        return {"commits": bridge.commits, "markers": bridge.marker_count,
                "last_checkpoint": (planner.checkpoint.file, planner.checkpoint.position)}
    finally:
        bridge.abort()
        if stream is not None:
            stream.close()
