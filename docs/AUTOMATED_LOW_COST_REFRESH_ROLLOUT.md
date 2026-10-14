# Low-cost automatic refresh rollout (PR #112)

## Invariant
Railway is the only ingestion leader. Render is hot/warm standby and uses the same read database but **must never run schedulers**. No automatic full purge. Database-backed sync leases prevent overlapping source writes.

## Initial production settings (apply only after green CI, source tests and operator approval)
- Railway: `ENABLE_AUTHORITATIVE_INCREMENTAL_SCHEDULER=true`
- Railway: `SOURCE_CHANGE_POLL_SECONDS=300` (5-minute watermark poll; can lengthen to 600–900s to save more)
- Railway: keep `TRAFFIC_SAVER_MODE=true` so reports, maintenance and other background tasks remain paused
- Railway: `ENABLE_DAILY_INCREMENTAL_RECONCILIATION=false` to avoid a duplicate midnight job
- Render: `STANDBY_MODE=true` and `ENABLE_AUTHORITATIVE_INCREMENTAL_SCHEDULER=false`
- Both: keep `ENABLE_GOVERNED_SOURCE_CUTOVER`, `ENABLE_SEMANTIC_SHADOW_WORKER`, `ENABLE_SEMANTIC_OBJECT_PUBLISH`, `ENABLE_SEMANTIC_RECOMPUTE`, `ENABLE_SEMANTIC_DASHBOARD_SERVING` off until independently validated.

With SQL sources, a lightweight watermark check runs every 300 seconds. If source watermarks haven't advanced, skip extracting report rows. Existing `cfg.scheduleHours` governs heartbeat reconciliation. API sources cannot use SQL watermarks and use scheduled heartbeat polling.

## Acceptance gates before enabling
1. CircleCI including source, daily refresh, UI and security checks passes on exact PR head.
2. Run read-only SQL preflight, then a bounded incremental refresh on Playground (NOT production) with representative change, deletion and retroactive correction cases.
3. Verify no 250,000-row extraction limit, no unintended purge, and correct last-successful dashboard fallback on PARTIAL.
4. Confirm Neon compute and transfer, source query costs, freshness lag and queue depth for 24 hours in a canary.
5. Enable only one Railway ingestion leader. Check logs for one scheduler startup and successful incremental or no-change skip; confirm Render standby logs lack scheduler startup.
6. Disable via `ENABLE_AUTHORITATIVE_INCREMENTAL_SCHEDULER=false`; redeploy if runaway costs or stale results. This switch does not invoke destructive resets.

## Still not complete
- End-to-end historical recomputation, tenant/cohort parity, and worker retry/dead-letter recovery.
- Governed candidate source cutover using ten-feed full reconciliation, approved vault credentials and safe rollback.
- Live published semantic-serving parity tests and performance/load benchmarks.
- Persistent cross-host deployment parity checks and alerts for data freshness / Neon egress.

Do not claim complete Power BI-style automated semantic processing just because the source scheduler starts.
