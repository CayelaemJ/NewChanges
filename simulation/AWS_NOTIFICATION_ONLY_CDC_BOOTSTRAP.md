# AWS ingest_stage — notification-only CDC bootstrap design

**Status: proposed implementation contract, NOT deployed, no current AWS binlog stream.**
Read alongside `AWS_INGEST_STAGE_OPERATOR_HANDOFF_2026-11-17.md`.

## Decision: query source views; do not replicate existing reporting tables

The Fixer will keep the authoritative reporting data and calculations in AWS RDS MySQL `ingest_stage`. A CDC worker should emit **opaque change notifications** from committed ROW binlog transactions. Dashboards query the existing ten `v_*` views on initial load and requery only affected queries when generation changes. Avoid storing employee/debt/policy row images in the CDC sink. The separate, currently implemented **local** sink/snapshot pipeline is a different (state-replication) mode and must not be silently used against AWS.

### Notification-only baseline: correctness contract

A notification-only pipeline does not need to copy existing physical rows into a second DB, **but it does need a truthful handoff**:

1. Store an immutable source identity (RDS instance identity + database + allowlisted source table set), verified 10-feed contract fingerprint, schema/version, and operator approval in a durable store.
2. Acquire a **verified current binlog file/position before any initial dashboard reads**; persist that coordinate as a *notification baseline*, not as evidence of importing historical records. Store the bootstrap timestamp, approval, and client baseline generation. Do not use this coordinate for the existing `SnapshotHandoff` state-replication contract.
3. Start streaming from the persisted baseline coordinate while the log remains available. On event receipt, accumulate rows only until corresponding XID/commit, produce metadata-only feed invalidations, and atomically persist invalidations plus checkpoint before acknowledging the source position. Ignore rolled-back changes.
4. A dashboard subscribes to generation notifications and **always queries the authoritative MySQL view** for its initial data. Establish subscription/generation checks so no update between the first query and subscriber registration can be missed; e.g. read generation, query view, then reread generation and requery if it changed.
5. If a worker is down, recover from its durable checkpoint within the 24-hour retention period. If the log has been purged or schema/instance lineage changes: **fail closed**, mark health as degraded and perform a *new explicitly approved baseline/reconciliation*. Never silently skip to current position. For existing open clients, send a forced-refresh notification on successfully completed resynchronization.
6. On failover/connection loss, retry with bounded exponential backoff and jitter. Reject overlapping workers and use a durable owner/lease to ensure single checkpoint writer. Check retention and storage pressure regularly.
7. The MySQL replication account has **global** binlog access even though code filters ten tables. Audit source sensitivity, credential storage, network egress, TLS chain and replication library capabilities before any real streaming. Always redact raw row images.
8. A real UPDATE changes the relevant feed generation even when synthetic `source_updated_at` remains stale; NEVER use dummy future timestamps as a CDC watermark.
9. Only after integration tests verify INSERT/UPDATE/DELETE, rollback, schema drift, reconnect, rotation, event replay, checkpoint/notification atomicity, and browser dashboard refresh may the system be labelled **LIVE CDC**.

### Important distinction

- **Notification-only CDC:** baseline coordinate + MySQL view queries; no historical copy, but historical facts remain in source MySQL. It can correctly invalidate *current view results* if bootstrapped and recovered as above.
- **State-replication CDC:** requires a transactionally consistent row snapshot, verified imported baseline and a snapshot-aligned binlog coordinate. The existing `SnapshotHandoff` and local Docker sink implement this pattern. Do not falsely mark a notification baseline as a completed state snapshot.

### Current verified operator evidence (17 November 2026)

- All ten tables' `_ingest_id` are BIGINT primary keys; matching views and generated UTC normalization; no unexpected objects; `import_manifest.loaded_at` TIMESTAMP.
- Dedicated CDC user authenticated over TLS, has REPLICATION CLIENT and SLAVE and schema SELECT; binlog status is readable.
- ROW/FULL logging and 24-hour retention verified by operator.
- Historical `source_updated_at` is synthetic: employee source normalization showed every audited value 2026-12-31. Do not backfill NOW() or confuse import_manifest.loaded_at with upstream source modification.
- **No worker, durable notification sink, browser subscription or AWS CDC end-to-end test has been verified.**

### Implementation milestones

- [ ] Finalize an inexpensive *durable* operational store for checkpoint, source fingerprint, feed generation and worker lease (not a full reporting-data replica).
- [ ] Add notification-only bootstrap type separate from `SnapshotHandoff`, with file/position lineage + explicit approval; reject arbitrary wall-clock cursors.
- [ ] Add TLS-verified, allowlisted AWS binlog reader in its own module, NOT by removing local Docker guard.
- [ ] Persist metadata-only transaction commit and checkpoint atomically, including feed generations.
- [ ] Implement backend SSE/WebSocket changes + generation API; verify subscription race prevention and tenancy authorization.
- [ ] Map joins/dependencies between views and metrics using actual view definitions (name correspondence alone is not enough).
- [ ] Test restart, retention expiry, credentials rotation, failures, slow dashboards and source data classification.
- [ ] Choose a 24/7 host; local WSL is development-only.
