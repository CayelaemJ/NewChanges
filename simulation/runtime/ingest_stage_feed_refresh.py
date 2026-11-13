"""Pure feed-generation invalidation planner for the ingest_stage pilot.

NO database, HTTP, RDS or PostgreSQL access; never contains raw source rows.
Callers must acquire separately approved read-only MySQL reporting access.
This module is NOT the production dashboard integration or CDC consumer.
"""
from dataclasses import dataclass

from .ingest_stage_contract import FEED_TABLES

REQUERY_MYSQL = "REQUERY_MYSQL"
UNCHANGED = "UNCHANGED"
DEFER_RATE_LIMIT = "DEFER_RATE_LIMIT"
BLOCKED_SOURCE = "BLOCKED_SOURCE"


@dataclass(frozen=True)
class FeedRefreshPlan:
    """A single canonical feed invalidation, not a source-row update."""

    feed: str
    generation: int
    action: str
    unfiltered_mysql_view_required: bool


def _generation(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(f"Invalid {label}")
    return value


def plan_feed_refresh(
    *, feed, cached_generation, notified_generation,
    mysql_source_authorized, source_snapshot_verified,
    now_ms, last_query_ms=None, min_query_spacing_ms=1000,
):
    """Plan an on-demand feed refresh from canonical MySQL view only.

    The caller's authoritative MySQL view read MUST NOT filter using the
    unreliable source_updated_at value. Source row ID is absent from all ten
    canonical views, so selective row refresh cannot be inferred.
    The caller must persist its *applied generation* only after a successful
    read and cache replacement. This function intentionally performs no IO.
    """
    if feed not in FEED_TABLES:
        raise ValueError("Unapproved canonical CDC feed")
    old = _generation(cached_generation, "cached generation")
    observed = _generation(notified_generation, "notification generation")
    if observed < old:
        raise ValueError("CDC notification generation regressed")
    if not isinstance(mysql_source_authorized, bool) or not isinstance(
        source_snapshot_verified, bool
    ):
        raise ValueError("Source authorization/snapshot status must be explicit")
    if isinstance(now_ms, bool) or not isinstance(now_ms, int) or now_ms < 0:
        raise ValueError("Invalid monotonic clock")
    if (isinstance(min_query_spacing_ms, bool) or
            not isinstance(min_query_spacing_ms, int) or
            min_query_spacing_ms < 0):
        raise ValueError("Invalid query interval")
    if last_query_ms is not None:
        if (isinstance(last_query_ms, bool) or not isinstance(last_query_ms, int)
                or last_query_ms < 0 or last_query_ms > now_ms):
            raise ValueError("Invalid last query clock")

    if observed == old:
        action = UNCHANGED
    elif not mysql_source_authorized or not source_snapshot_verified:
        action = BLOCKED_SOURCE
    elif last_query_ms is not None and now_ms - last_query_ms < min_query_spacing_ms:
        action = DEFER_RATE_LIMIT
    else:
        action = REQUERY_MYSQL
    return FeedRefreshPlan(
        feed=feed,
        generation=observed,
        action=action,
        unfiltered_mysql_view_required=(action == REQUERY_MYSQL),
    )


def acknowledged_generation(*, previous_generation, observed_generation,
                             source_read_succeeded):
    """Move cache generation forward only after successful MySQL requery."""
    old = _generation(previous_generation, "cached generation")
    observed = _generation(observed_generation, "notification generation")
    if observed < old:
        raise ValueError("CDC notification generation regressed")
    if type(source_read_succeeded) is not bool:
        raise ValueError("Source read outcome must be explicit")
    return observed if source_read_succeeded else old
