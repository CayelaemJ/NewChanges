# Different-source reporting dataset replacement (design / release gates)

**Status:** preview-only. No execution endpoint exists. The existing `RESET` button is NOT a dataset replacement workflow.

## Immutable boundaries

- Keep the current **Neon application PostgreSQL database** and credentials, user accounts/password hashes, partner brands, roles, section access, audit and security records.
- Keep Railway as the *single* ingestion authority; Render always stays standby without ingestion.
- Incoming production SQL database is DIFFERENT from current test source; equivalent-source fast cutover is not applicable.
- Employer ID / foreign-key collision is a SECURITY problem, not merely an import issue. Never automatically grant existing test employer permissions to production employers on matching IDs.
- Do not reuse integration cursors when a source generation changes.
- Never delete live datasets before verifying and preserving a recoverable checkpoint and testing restore.
- Do not enable semantic-serving or background semantic workers during replacement.

## Phase 1: read-only operational preflight

`GET /api/admin/integration/dataset-replacement/preview`: SUPERADMIN-only reporting and identity-link inventory, no writes.

`POST /api/admin/integration/dataset-replacement/validate-source`: SUPERADMIN-only, requires `ENABLE_DATASET_REPLACEMENT_PREFLIGHT=true`; candidate mode must be SQL, candidate identity must differ from live source and all ten canonical views must pass read-only validation. Payload uses the existing source-switch integration patch fields; do not store credentials or return candidate settings in the response. Preflight is not cutover authorization. Flag defaults OFF.

## Phase 2: safety plan (not yet implemented)

1. Disable new source scheduling; acquire exclusive DB-backed ingestion lease, prove no in-flight writes.
2. Validate all ten candidate view contracts, row counts, stable natural keys and change-watermark behavior. Detect orphaned employee/employer references.
3. Establish a temporary Neon recovery branch/snapshot; demonstrate rollback from it without touching production before proceeding.
4. Explicitly map production employer identities to access grants; revoke stale test user/employer links and report schedule targets after preserving required user-owned configuration. Treat ambiguous assignments as denied.
5. Identify exactly which fact, history, projection and cache tables are source-owned vs. user-owned. Inspect FK cascades and audit retention. **Do not use TRUNCATE CASCADE**. Only use SQL-native bulk clearance for independently safe tables; preserve tenant identities and logging.
6. Import the different source once with bounded SQL bulk writes. Stage all ten feeds and materializations before publishing a new generation and pointer. Never expose a partially loaded data set to dashboards.
7. Validate canonical counts, business-date history, employer visibility and frontend against old published snapshot; activate a generation atomically; resume incremental poller. Preserve rollback path until signed off.

## Cost/quality acceptance

- Report total source rows, prospective data-clear operations, expected disk/WAL overhead, snapshot size, and new compute cost *before confirmation*. Forecast is an estimate, not a billing quote.
- No repeated delete/reinsert cycles for unchanged data. No automatic hourly bulk heartbeats.
- Configure small bounded extraction and worker batches and explicit storage / recompute budgets.
- Confirm failed validation or interruption never purges active data.
- Keep actions independently confirmed and audited, protected against concurrent sync. Require super-admin and a second confirmation before execution.
- Playground destructive rehearsal and rollback are prerequisites to Production.

This phase deliberately cannot delete data or switch a database.
