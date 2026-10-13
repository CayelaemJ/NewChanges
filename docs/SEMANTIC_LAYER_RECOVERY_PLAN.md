# NewChanges semantic layer recovery — implementation plan

## Non-negotiable priorities (in order)
1. **Speed:** dashboard actions should use precomputed versioned results or memory hits, not scan large raw tables. Measure p50/p95 latency.
2. **Cost:** minimise Neon transfer and compute, not just request counts. No PostgreSQL writes on normal GETs, no duplicate schedulers, no full rebuild when unchanged. Measure bytes transferred, writes, compute usage and cache hit rate.
3. **Latest data:** continuously detect source changes, durably capture them, then atomically publish refreshed semantic partitions. Trigger invalidation from source version/watermark, not an arbitrary cache expiry. Display the last processed source watermark and freshness lag. A 5-minute TTL alone is NOT real-time freshness.

## Operational policy
- **Read path:** serve an immutable in-memory snapshot first; bounded miss handling. Do not query Neon once per widget/filter if a usable same-version semantic snapshot exists.
- **Write path:** only genuine business/source changes go through durable deduplicated batches; no analytics/pageview writes under emergency traffic saver.
- **Refresh:** one scheduler owner, incremental updates and coalescing; no periodic complete rebuild unless explicitly requested or reconciliation needs it.
- **Consistency:** Railway and Render must have the same published semantic version. Local RAM is a cache, never the sole durable copy.
- **Failover:** serve last known good snapshot with visibly stale state during an outage; never falsely label stale data as current.
- **Safety:** preserve durable user writes, access control and audit requirements. Do not acknowledge undurable captured source events.

## Acceptance targets to measure (provisional, not achieved)
- p95 cached dashboard read under 300ms at normal pilot load.
- >95% dashboard requests served without raw PostgreSQL data scans.
- Under 60 seconds from an observed source change to published semantic snapshot when upstream capabilities and capacity permit; otherwise show measured lag.
- No PostgreSQL writes from ordinary dashboard GETs.
- Traffic/compute daily budget measured under representative load; alert before Neon quota exhaustion.
- No lost acknowledged events on restart or provider failure.


Status: **work in progress / not approved for merge**.

## Phase 1 — Stabilize current workloads (first changes in this PR)
- Lengthen the per-instance in-memory dashboard cache default to five minutes (configurable with SEMANTIC_CACHE_TTL_MS, bounded to 1–30 minutes).
- Disable persistence of calculated cohort cache rows on ordinary GET dashboard requests by default. SEMANTIC_PERSIST_ON_READ=true restores legacy behavior.
- Keep explicit publish/snapshot write flows intact. Do not disable essential durable business writes.
- Retain the existing emergency traffic-saver behavior pending source-tracking replacement.

## Phase 2 — Durable incremental ingestion (not implemented yet)
- Assign a single background worker as sync owner. Keep Render standby non-writing.
- Capture source changes via watermarks / CDC where supported, with durable checkpoints.
- Batch and deduplicate changes. Reconcile deletions and late arriving updates.
- Preserve provenance, idempotency and exact restart recovery. Never acknowledge events before durable commit.

## Phase 3 — Shared versioned semantic model (not implemented yet)
- Precompute common employer, partner, period and cohort measures into immutable versioned snapshots.
- Serve users from snapshots and process cache misses with bounded concurrency.
- Use shared cache/object storage for cross-host consistency rather than treating app RAM as durable storage.
- Tag snapshots with source watermark, as-of time, publication version and freshness state.
- Maintain tenant/role isolation on every read.

## Phase 4 — Diagnostics, budgets and rollback (not implemented yet)
- Measure Neon transfer bytes, connection counts, query latency, DB writes and dashboard cache hit rates.
- Add clear dashboard state: fresh, stale, unavailable, rebuilding.
- Verify both Railway and Render connection targets, login, access control, historical measures and restart behavior.
- Establish a measured traffic budget before turning scheduled refresh back on.

## Release gates
- GitHub CI, integration and load checks green.
- No writes from GET/read-only traffic by default.
- Existing data preserved and restored from an independently verified backup.
- Both deployments tested against the correct Neon primary and a snapshot fallback.
- No merge to main without explicit user approval.

**Caution:** Local in-process caches are per-container and disappear on restart. This phase reduces traffic but does not create a fully shared Power BI-style semantic model, and it cannot remove a Neon quota suspension.
