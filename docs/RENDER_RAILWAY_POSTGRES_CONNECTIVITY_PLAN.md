# Render application + company Railway PostgreSQL — read-only canary

## Audited environment on 18 October 2026

- Render has an existing `newchanges-standby` free web service. Updated
  Render deployment `dep-dba893mq1p3s73amugu0` from commit `12e418a0`
  reported `live`. Startup logs show HTTP 200 on `/` and
  `STANDBY_MODE enabled: background schedulers and bootstrap writes are disabled`.
- Railway project `merry-cooperation` has NewChanges and MySQL services
  but no PostgreSQL service. Production NewChanges currently uses Neon.
- A separate company workspace project, `EFS React Migration Test`,
  has a live, volume-backed PostgreSQL service in environment
  `migration-test`. This is not approved as a Production database,
  and it must not be overwritten or reused without its owner's consent.
- Render's free service may sleep or spin down during inactivity. An
  in-process 30–60-second polling scheduler cannot guarantee an always-on
  refresh interval if the application process sleeps. Reliable freshness
  requires an always-on ingestion worker or independently scheduled source
  events. Do not advertise a 60-second SLA from a sleeping standby process.

## Safely verify Render-to-Railway PostgreSQL connectivity

`node scripts/probe-render-railway-postgres.mjs` implements a separately
approved, **read-only** connectivity check. It requires:

- `RENDER_RAILWAY_PG_PROBE_APPROVED=YES_READ_ONLY_RAILWAY_TEST`
- `RAILWAY_PG_TEST_URL`: a public, TLS-required Railway PostgreSQL URL,
  **different from the running app's `DATABASE_URL`**.
- `RAILWAY_PG_EXPECTED_DB`: exact expected database name.

It rejects a private `*.railway.internal` hostname because a Render
instance cannot assume access to Railway's private service network.
It uses a bounded timeout and `BEGIN READ ONLY`, verifies the
database identity and a live TLS connection, rolls back, and never
updates the application connection string or any schema. It does not
log passwords, source rows, hostnames or raw driver errors.

**Not executed against a real Railway database yet.** Database owner
must authorize a nonprivileged test role and a dedicated test database
before the canary is run; prefer validated CA/certificate checking for
the actual production database connection.

## Deployment and cost gates

1. Company's Railway owner supplies an explicitly budgeted,
   backup-protected, production-appropriate PostgreSQL instance under
   the NewChanges project, with a public TLS endpoint and least-privilege
   credentials. This can be an appropriately sized existing authorized
   Railway Postgres service; do not automatically create a new billable
   service or use the unrelated EFS migration-test data.
2. Validate Render outbound connectivity from the free standby using
   this read-only canary. A successful connection probe **does not**
   prove SQL migrations, data parity, permissions, latency or failover.
3. Back up and reconcile Neon data; rehearse transaction-safe
   migration/cutover on an isolated, rollback-capable Railway target.
   Changing `DATABASE_URL` on the running app is forbidden until
   reconciliation, rollback and release approval pass.
4. Deploy the Render app with standby protection first, verify
   `/ready` (database-backed), auth, UI and ten-feed dashboards.
5. Choose one authoritative sync worker only, verify indexed
   source-watermark polling and 30–60-second target for detection.
   Test updates and tombstoned deletions, rebuild duration, browser
   freshness, lock acquisition, reconnection and crash recovery.
   Do not run active ingestion on both Render and Railway.

CI verifies the canary rejects wrong/production targets, unsafe
credentials and missing approval; it does not independently establish
real network connectivity or Production readiness.
