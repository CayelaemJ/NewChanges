# PR #109 release readiness — 14 October 2026

## Implemented on the draft branch
- Existing Admin connection preview and encrypted candidate staging (read-only contract preflight).
- AES-256-GCM connection vault keyed by `SOURCE_CONNECTION_VAULT_KEY` (never log or send credentials to browser).
- Existing source bootstrap and governed equivalent-source activation/restore endpoints, SUPERADMIN-only. Activation requires all ten SHA-256 feed content digests, row counts and source watermarks to match, plus fresh reconciliation, unchanged integration cursors, database advisory lock and a serializable transaction. No purge is involved.
- Bounded one-time source reconciliation CLI `npm run semantic:reconcile:once`, which reads canonical views and stores only hashes/counts/checkpoints, not bulk data, in Neon.
- Bounded historical partition planner, deduplicated semantic queue, lease-based worker, shadow enqueue, opt-in worker command.
- S3 SigV4 signer with environment-secret configuration, upload/readback digest verification, immutable manifest metadata, transactional publication/rollback primitives.
- Permission-scoped publication polling and opt-in React automatic dashboard refresh (visible tabs only).
- Super Admin-only semantic canary endpoint; optional exact-period semantic reads with legacy dashboard fallback and normal module permissions.
- CI regression scripts for source safety, historical planning, S3 signing, encrypted vault, feed continuity and reconciliation.

## Mandatory switches — all off by default
`ENABLE_GOVERNED_SOURCE_CUTOVER`, `ENABLE_SEMANTIC_SHADOW_ENQUEUE`, `ENABLE_SEMANTIC_SHADOW_WORKER`, `ENABLE_SEMANTIC_OBJECT_PUBLISH`, `ENABLE_SEMANTIC_RECOMPUTE`, `ENABLE_SEMANTIC_CANARY_READ`, `ENABLE_SEMANTIC_DASHBOARD_SERVING`, `ENABLE_SEMANTIC_LIVE_NOTIFICATIONS`.

## Production release blockers
1. GitHub CI currently returns failed jobs without usable steps/log artifacts. Do not merge as verified until this is resolved and checks pass.
2. New Prisma models are not migrated to Neon. Take a verified backup and apply non-destructive schema changes on a staging branch first.
3. Railway S3 bucket `newchanges-semantic-snapshots` is staged in `ams`, **not provisioned**. A real private bucket and runtime credential references must be configured and verified.
4. No verified SOURCE_CONNECTION_VAULT_KEY exists in the app environment. Do not invent one or overwrite existing source secrets.
5. A data-different cutover still needs staged historical fact reconciliation and full semantic parity. The equivalent-only cutover MUST fail closed when rows/digests differ.
6. Live semantic serving needs cohort/filter parity tests, security tests, load tests and a controlled canary before enabled.

## Cost guard
No live semantic jobs, source switching, S3 operations or Prisma production migrations have been triggered in this PR work. One-time full-feed SHA reconciliation is limited by a strict row budget and is never scheduled automatically. Keep max Neon compute conservative and monitor source freshness, queue size, egress, bytes recomputed and dashboard response time before enabling any worker.
