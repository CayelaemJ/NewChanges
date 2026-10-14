# Durable change processing and external object verification

## Added in this revision of PR #109
- `SemanticRefreshJob` PostgreSQL queue with a unique idempotency key, bounded attempts and cross-process `FOR UPDATE SKIP LOCKED` job leasing.
- `enqueueSemanticRefresh` accepts coalesced partitions after the canonical ingestion transaction has succeeded; unchanged source data must not enqueue work.
- `semanticObjectVerification` writes a bounded immutable binary payload to a trusted provider's server-side presigned HTTPS PUT URL, independently downloads it through a presigned GET URL and verifies both size and SHA-256.
- Regression safety guards for deduplication, leasing, and object verification.

## Deliberately not wired to production
The queue is not yet fed from the source ingestion transaction/outbox, and no worker currently computes objects from these jobs. Presigned URLs require a real storage credential broker and bucket configuration; a write-and-read verifier is not a full object store deployment. Publication gates continue to fail closed. No UI switches to these objects yet.

## Required before enabling
1. Apply Prisma migration in staging and test rollback.
2. Ensure enqueue and durable source commit use one idempotent transaction/outbox, even on worker crash.
3. Expand retroactive historical dependency ranges and encode the full employer/site/income calculation contract.
4. Configure authenticated object store; keys must be tenant-partition scoped, never public, with bucket encryption and lifecycle rules.
5. Validate the uploaded object with the independent GET proof, persist proof metadata, and check ten-feed reconciliation.
6. Atomically compare-and-swap the published pointer with a publication audit row, then notify Railway and Render.
7. Test failover, source switches, deletion corrections, tenant isolation and cache freshness.

## Cost discipline
No full purge on an ordinary source change; no writes per dashboard pageview; no duplicate queueing on retry. Keep import and rebuild concurrency bounded and explicitly measure Neon compute/egress before rollout.
