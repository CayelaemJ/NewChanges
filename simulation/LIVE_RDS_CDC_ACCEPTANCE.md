# The Fixer — controlled live AWS RDS CDC activation and acceptance

Status: **NOT AUTHORIZED / NOT ACTIVE**. This is a verification checklist, not an activation script.
Linked: PR #237, issue #241 (production safety), issue #251 (multi-source registry).

## Definition of done

A controlled, authorized write to an approved `ingest_stage` source row (or an isolated approved canary source) generates a committed MySQL ROW/FULL binlog event. An independently authorized consumer sees the committed event, durably records its checkpoint and affected feed **without storing sensitive row data**, invalidates only the matching source/tenant/employer reporting generation, rereads the authorized MySQL view/aggregation, publishes the completed dashboard version, and the browser displays the change. Record evidence including event ID/digest, checkpoint, source/tenant/feed, old/new dashboard version, mutation time, publication time and p50/p95 latency. Do not log raw values.

## Pre-activation, no-write evidence

- Confirm target RDS instance/region, source DB/schema, approved tenants, reporting views, actual physical-table-to-feed mapping, DDL/trigger/change semantics and data classification with metadata-only reads.
- Verify effective `log_bin=ON`, `binlog_format=ROW`, `binlog_row_image=FULL`, `SHOW BINARY LOG STATUS`, effective RDS binlog retention and CloudWatch free-storage/backup pressure. The last recorded retention value was **NULL**, which blocks activation.
- Establish privacy review of broad binlog exposure and use a dedicated minimally privileged replication identity; do not reuse the RDS master account. Separately provision a dedicated least-privilege reporting reader limited to approved views, with verified TLS/hostname and query budgets.
- Produce a consistent full initial snapshot of existing nonempty source feeds and record a verified manifest + snapshot-to-binlog handoff; never bootstrap a populated source at the current binlog tip.
- Provide durable per-source/per-tenant/per-consumer checkpoints, fencing, crash/replay recovery, rotation/gap detection, lag/retention monitoring and failure alerts.
- Replace the current process-local-only cache generation with atomic, durable multi-worker successful-publication versions and tenant-authorized event delivery.
- Implement source-side aggregates and parity tests for existing dashboards. The current bounded row reader/row-count prototype is **not** the business dashboard.
- Obtain explicit infrastructure, cost, privacy, security and deployment approval before any RDS settings/grants/network or production write.

## Controlled acceptance scenario (only after the above gates)

1. Deploy into an isolated staging application wired to the authorized CDC integration, not the existing production dashboard; verify read-only mode against a verified consistent snapshot.
2. Record an authorized canary's current displayed aggregate, generation and checkpoint. Use a dedicated synthetic identifier or approved test row only; never modify a real employee/debt/financial record for demonstration.
3. With the existing source owner approving each mutation, issue a committed INSERT, then UPDATE, then DELETE, with the same-second-update and rollback scenarios. Mutations must be explicitly constrained to approved test data.
4. Verify exact committed events and affected feed notification(s), no checkpoint advancement before commit, no notification for rollback, no duplicate publication on replay, stable business calculations and source/tenant isolation.
5. Verify the dashboard actually rereads MySQL and publishes a new version *after* successful aggregation; compare to an independent bounded read-only SQL check. Measure latency and error/retry behaviour.
6. Restart the consumer during a controlled run; prove resume from durable checkpoint, idempotency and safe failure when binlog gap, privileges, network or TLS are invalid.
7. Validate the mobile/desktop responsive admin monitoring, accessibility, truthful health/lag metrics, production default-off gates and rollback procedure. Only after evidence and owner signoff consider production cutover.

## Rollback / incident response

- Disable the production CDC activation flag and stop the dedicated consumer. **Do not** delete checkpoints or purge binlogs.
- Preserve the last fully published dashboard generation; surface a stale-data/degraded warning. Legacy import behaviour should not silently be represented as CDC.
- Preserve logs with secret/PII redaction, monotonic checkpoint metadata and diagnostic event references. Investigate, replay from a valid retained binlog, or require a fresh approved consistent snapshot if the gap is unrecoverable.
- Restore an approved previous application release if necessary; never roll back source records or RDS settings automatically.
- Escalate credential or cross-tenant data leaks privately, revoke affected credentials after safe containment, and revalidate before reactivation.

## Current evidence (17 November 2026)

Operator WSL: `bash scripts/pr237-preflight.sh --full` at `965fe1e4`: 41/41 Node CDC tests and 118/118 disposable Docker MySQL tests, frontend build and TypeScript succeeded. Earlier Vitest: 26/26. These results **do not** constitute live AWS acceptance. Additional oversized-event guard work on the same PR requires rerunning validation at its new HEAD.
