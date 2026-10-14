# Semantic storage rollout status (2026-10-14)

## Railway object bucket
A private S3-compatible bucket **newchanges-semantic-snapshots** has been staged in Railway production environment in `ams` region, bucket ID `2626f99a-75a5-43f2-8210-27c2b40ea7eb`. Staged patch `761bf853-fe1c-4215-b71d-1d3cd9fce934` is **NOT applied**. Review and apply separately; never commit unrelated staged changes without inspecting the patch.

## Shadow ingestion queue
When `ENABLE_SEMANTIC_SHADOW_ENQUEUE=true` and `SEMANTIC_ACTIVE_SOURCE_GENERATION_ID` references a source-generation record with state `ACTIVE`, successful non-full source synchronization can enqueue bounded current-period shadow jobs for employers with changed canonical feeds. It does not replace or delay live dashboard snapshots; a failure is recorded in sync summary.

This is deliberately **not complete selective historical recalculation**. Historical corrections and tombstones may affect other months, so the full dependency-aware recomputation pipeline remains disabled. The shadow queue only exercises durable delivery and snapshot comparison.

## Next production release gates
- Apply a reviewed Prisma schema migration after taking and validating a backup.
- Apply bucket staging separately and configure server-side credentials and a storage presigning broker; no credentials belong in repository or API responses.
- Reconcile ten canonical source feeds and stage real source generation with independent cursors.
- Implement complete effective-date dependency tracing and transactional ingestion outbox.
- Integrate serving from durable external objects only after tenant access controls, checksum readback, historical parity and load tests.
- Add cross-deployment version notification through durable publication sequence. Do not rely on local in-memory event signals.
- Verify CPU, database egress, storage operation charges and user-facing freshness in a measured canary.

No migrations, publication switches or credentials changes were made by this development branch.
