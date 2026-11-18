"""Translate MySQL row-binlog event shapes into opaque markers, offline only.

No MySQL or replication connection. A future approved worker must supply
actual WriteRows/UpdateRows/DeleteRows events and explicit XID boundaries.
"""
from .ingest_stage_contract import make_change_marker
from .ingest_stage_txn import LogCoordinate

_KIND = {
    "WRITE_ROWS": (None, "values", "INSERT"),
    "UPDATE_ROWS": ("before_values", "after_values", "UPDATE"),
    "DELETE_ROWS": ("values", None, "DELETE"),
}


def stage_row_event(planner, *, kind, event, binlog_file, hmac_secret,
                    captured_at_utc=None):
    """Stage a row event inside an already-open source transaction.

    Raw row images are examined only in memory, never persisted, returned or
    logged. A failure aborts the entire in-memory source transaction.
    """
    if kind not in _KIND:
        planner.abort()
        raise ValueError("Unsupported binlog row event kind")
    try:
        old_key, new_key, operation = _KIND[kind]
        rows = getattr(event, "rows", None)
        packet = getattr(event, "packet", None)
        position = getattr(packet, "log_pos", None)
        if not isinstance(rows, (list, tuple)) or not rows or len(rows) > planner.max_rows:
            raise ValueError("Unsupported binlog row batch size")
        coordinate = LogCoordinate(binlog_file, position)
        markers = []
        # Prevalidate every row before staging; avoid partial batch acceptance.
        for row_index, row in enumerate(rows):
            if not isinstance(row, dict):
                raise ValueError("Invalid binlog row image")
            before = row.get(old_key) if old_key is not None else None
            after = row.get(new_key) if new_key is not None else None
            markers.append(make_change_marker(
                schema=getattr(event, "schema", None),
                table=getattr(event, "table", None),
                operation=operation, old=before, new=after,
                binlog_file=binlog_file, binlog_position=position,
                row_index=row_index,
                binlog_timestamp=getattr(event, "timestamp", None),
                hmac_secret=hmac_secret, captured_at_utc=captured_at_utc,
            ))
        for marker in markers:
            planner.stage(marker, coordinate)
        return len(markers)
    except Exception:
        planner.abort()
        raise
