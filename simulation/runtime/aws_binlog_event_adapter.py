"""Offline adapter from mysql-replication events to the notification bridge.

No network access, no AWS streaming, no row-value logging or persistence.
Caller must restrict exposure, verify TLS and snapshot/notification baseline,
and validate transaction boundaries and rotation in the eventual AWS reader.
"""
from .aws_notification_bridge import NotificationTransactionBridge

_KINDS = {
    "WriteRowsEvent": "WRITE_ROWS",
    "UpdateRowsEvent": "UPDATE_ROWS",
    "DeleteRowsEvent": "DELETE_ROWS",
}


def accept_parsed_event(bridge, event, *, binlog_file):
    """Adapt a *trusted* mysql-replication event to metadata only.

    Events from nonallowlisted tables must be filtered by the future stream
    BEFORE invoking this function; never process arbitrary row images here.
    """
    if not isinstance(bridge, NotificationTransactionBridge):
        raise TypeError("Notification bridge required")
    try:
        event_type = type(event).__name__
        position = getattr(getattr(event, "packet", None), "log_pos", None)
        if event_type == "XidEvent":
            return bridge.xid(file=binlog_file, position=position)
        operation = _KINDS.get(event_type)
        if operation is None:
            raise ValueError("Unexpected binlog event type")
        # Only len(rows) is accessed. Raw source values never leave the event.
        rows = getattr(event, "rows", None)
        if not isinstance(rows, (list, tuple)):
            raise ValueError("Missing row count")
        return bridge.row(
            operation=operation,
            schema=getattr(event, "schema", None),
            table=getattr(event, "table", None),
            file=binlog_file,
            position=position,
            row_count=len(rows),
        )
    except Exception:
        bridge.abort()
        raise


def consume_bounded_events(bridge, envelopes, *, max_events=500):
    """Process a bounded iterable of (event, filename) from a trusted source.

    It is unsafe to return successfully with half a transaction buffered.
    The event source is injected; this function MUST NOT open AWS connections.
    """
    if not isinstance(bridge, NotificationTransactionBridge):
        raise TypeError("Notification bridge required")
    if type(max_events) is not int or not 1 <= max_events <= 5000:
        raise ValueError("Invalid event limit")
    count = 0
    commits = 0
    try:
        for event, file in envelopes:
            count += 1
            if count > max_events:
                raise ValueError("Event limit exceeded")
            kind = type(event).__name__
            result = accept_parsed_event(bridge, event, binlog_file=file)
            if kind == "XidEvent" and result == "PERSISTED":
                commits += 1
        if bridge.pending:
            raise ValueError("Incomplete transaction: XID boundary missing")
        return {"events": count, "commits": commits}
    except Exception:
        bridge.abort()
        raise
