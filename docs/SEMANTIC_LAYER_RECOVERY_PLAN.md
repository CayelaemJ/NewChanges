# NewChanges semantic layer recovery — implementation plan

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
