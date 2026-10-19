# Production source refresh setting preservation

## Root cause verified 16 October 2026

The Railway Production pre-deploy step invokes `npm run db:deploy`.
Previously `scripts/deploy-db.mjs` invoked
`scripts/configure-mysql-sync.mjs` on every deploy when MYSQL* variables
were present. That helper indiscriminately overwrote the authenticated
admin's SQL source connection and TLS mode, while hardcoding
`scheduleHours=1`. The output incorrectly said a 24-hour interval.

## Safe behaviour introduced in this PR

- Every deployment preserves the existing `IntegrationConfig` source
  connection, TLS settings and schedule.
- One-time source bootstrap is available only by an explicit, manual command
  with `ALLOW_INITIAL_SOURCE_BOOTSTRAP=YES_I_APPROVE` and
  `SOURCE_SQL_SSL=true`, restricted non-root credentials supplied with the server-side
  `SOURCE_SQL_PASSWORD` secret and a verified certificate. The bootstrap
  leaves `IntegrationConfig.sqlPassword` NULL instead of persisting a new
  plaintext source password. The bootstrap only fills an unconfigured source; it refuses
  to overwrite established source settings or scheduling.
- No SQL source change or `IntegrationConfig` data correction is applied
  by merging this PR. All future changes require authenticated Admin
  review and a verified read-only TLS source connection.
- The five-minute `SOURCE_CHANGE_POLL_SECONDS` watermark watcher is
  independent of the configured scheduleHours fallback. When the source
  MAX(source_updated_at) values are unchanged, skipping a full sync is
  intentional and saves source query and Neon egress costs.

## Current Production audit (read-only)

On 16 October, Production IntegrationConfig reported MySQL SQL source,
`enabled=true`, `sqlSsl=false`, certificate trust enabled and
`scheduleHours=1`. Existing ten IntegrationCursor rows were last marked
OK around 11:35 UTC. Railway runtime logs repeatedly report unchanged
source watermarks around every five minutes thereafter, explaining why the
last full successful sync timestamp remains unchanged.

**Follow-up security gate:** Do not silently set SQL TLS to true without
verifying the server supports trusted certificate validation. Provision a
restricted account (never root) and rotate old stored source credentials
through the governed Admin workflow with a connection test and rollback
plan. Retain source data/history during any connection update.


## Near-real-time source drift safety — 19 October 2026

The 30–60-second watcher must not silently interpret a rebuilt, reset,
truncated, invalid-dated, or empty source as permanently unchanged.
The new watermark classifier reports per-feed `REGRESSED`, `MISSING`
or `INVALID` when existing cursor history conflicts with the returned
source maximum. When any anomaly is present, ordinary incremental ingestion
pauses and the watcher records a degraded/error state. Source data and
persisted cursors remain untouched; an approved replay/reset is required.

A **normal forward watermark** can still trigger a bounded incremental
sync, and an unchanged maximum remains inexpensive.

**Limit of MAX(updated_at):** removing an older record while leaving the
maximum unchanged is not detectable from that scalar. Reliable hard
deletions must use source-provided `is_deleted` tombstones, a change log,
CDC, or an explicitly scheduled, reconciled anti-join/full snapshot.
Do not advertise the 30–60-second target as proof of arbitrary deletion
capture or end-to-end materialisation latency.

**Deployment:** use exactly one authoritative always-on ingestion worker.
The existing free Render standby is for app/startup checks only; its
`STANDBY_MODE` prevents scheduled polling, and sleeping hosts cannot
guarantee minute-by-minute checks. Production Railway/Postgres ownership,
billing and a secure data migration remain a separate release gate.
