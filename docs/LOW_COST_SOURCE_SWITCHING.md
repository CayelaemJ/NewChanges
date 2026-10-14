# Low-cost source switching and live semantic refresh

## Delivered in PR 109
- Normal Admin Refresh now invokes incremental sync; the destructive reset remains a separately confirmed recovery operation.
- GET /api/admin/integration/changes checks SQL source watermarks without importing raw rows.
- POST /api/admin/integration/preview-switch accepts proposed connection details and checks all 10 canonical SQL view schemas and watermarks without storing credentials, changing checkpoints or touching existing dashboard data.
- POST /api/admin/integration/sync-now launches an asynchronous incremental job.

## Critical safety policy
A successful preflight does **not** prove that two databases have the same entity identities, chronology, deletions or contents. Never copy source watermarks/cursors from database A to B just because their 10 views share schemas. Do not purge the existing operational DB during a switch. An administrator should only activate a candidate after validating source identity and configuring a new checkpoint generation for the new source.

## Cost-efficient cutover design (not yet implemented)
1. **Candidate:** Store encrypted credentials with a source-generation ID; keep the currently active configuration unchanged.
2. **Validate:** Probe schemas, read-only permissions, stable employer/natural keys, canonical data model, source watermark quality and row-level continuity using bounded samples and targeted reconciliation.
3. **No change detected:** When a proven mirror presents the same identity and source generation, change the connection endpoint without reingestion and preserve cursors.
4. **New source identity:** Build its changes in a **staging generation**; use source-side key ranges, checksums/change tracking and deduplication to avoid rewriting equivalent rows. Store only changed facts and updated semantic partitions.
5. **Publish:** Atomically switch the active source and semantic generation after all required feeds are verified; keep the previous generation and last good dashboard available for rollback.
6. **Cleanup:** Retire old generation only after explicit retention/recovery checks. No DELETE/TRUNCATE as part of normal connection changes.

## Real-time semantics and costs
- Exactly one polling/CDC worker must own each source generation across Railway and Render.
- Use SQL Server Change Tracking/CDC when upstream can enable it; otherwise indexed source_updated_at watermarks with periodic reconciliation. MAX(source_updated_at) on a complex view may itself be expensive; prefer an inexpensive upstream change token/table.
- Coalesce source notifications; write only real changes to an immutable, versioned semantic model and use SSE to signal updated dashboards.
- Ordinary GET dashboard requests must not recalculate full raw cohorts or issue persistent cache writes.
- Measure source QPS, bytes pulled, Postgres network transfer/reads/writes, last successful watermark, semantic version and freshness lag.
- Keep user/account/permission/audit state in Neon. Do not discard historical facts until the replacement durable analytical store has passed restore and reconciliation tests.

## Not yet implemented
Encrypted persistent candidate profiles, source generation cutover transaction, source identity equivalence validation, full CDC integration, and externally backed semantic snapshots. A preview is *not* an activation.
