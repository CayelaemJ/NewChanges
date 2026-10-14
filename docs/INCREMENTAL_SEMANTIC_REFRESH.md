# Incremental semantic refresh planner — scoped rollout

## New working capability
The pure planner in src/services/semanticRefreshPlanner.ts coalesces incoming canonical changes into bounded employer/month work units. Duplicated employee/policy events do not multiply scheduled recomputations. Deletion markers are carried forward. A hard cap prevents unbounded batches.

## Critical limitation
A single observed-month partition is not *always* sufficient for derived point-in-time KPIs: retroactive eligibility or policy changes can affect many later months. The production worker must expand the impacted month range based on event effective dates, snapshot dependencies and historical correction rules. Until that dependency expander exists, the planner is NOT wired into production publishing.

## Safe integration requirements
1. Read durable outbox/change records from the successful ingestion transaction.
2. Resolve all dependent employer, site, income and historical periods including retroactive corrections and deletions.
3. Deduplicate within a source generation and persist a bounded refresh task with idempotency key (generation+partition+source watermark).
4. Coalesce bursts, limit parallelism, retry failures with dead-letter alerts.
5. Materialize immutable objects outside Neon, verify read-after-write digests and reconcile mandatory feeds.
6. Apply deterministic MLOps gates and perform an optimistic atomic publication-pointer transaction before notifying both runtime hosts.
7. Make UI clients observe a single version and present last-known-good state and staleness.
8. Verify data parity against existing dashboards and load-test compute/egress before enabling the new path.

## Cost guardrails
Avoid per-widget raw-table reads, full purge+reload, writes for unchanged data and duplicated scheduled jobs across Railway/Render. Track bytes in and out, query counts, batch recomputations, cache hits and source lag. No background publication should run simply due to a browser pageview.
