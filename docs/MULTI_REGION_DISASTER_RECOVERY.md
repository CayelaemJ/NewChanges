# NewChanges multi-region disaster recovery design

Status: PROPOSED — do not claim automatic failover is deployed.

## Baseline verified 2026-10-13
Railway project `merry-cooperation`: Production `NewChanges` is one application replica in `europe-west4-drams3a`. Production `Postgres-h_Ck` is one instance with a regional persistent volume in the same location. Testing is a separate environment, **not** a production failover target.

## Reliability objectives
- Regional application failure: serve traffic from an already-running replica in a second region without changing customer URLs.
- Railway-wide failure: independently hosted warm standby under the same public domain via an external load balancer.
- Database failover: exactly **one** writable leader; promote only with fencing/quorum; do not split-brain.
- Data integrity: published dashboard remains available during refresh failure; background imports/syncs run exactly once or are safe to retry.
- Define and test RTO/RPO explicitly. Neither zero downtime nor zero data loss is promised.

## Recommended target topology
1. Front door: customer-owned domain on Cloudflare Load Balancing with continuous origin health checks. Primary origin: Railway app; secondary: independent provider such as another managed platform or cloud VM. Configure standby to be hot/warm before enabling automatic failover. Static pages alone are not an API/database backup.
2. Intra-Railway regional availability: one NewChanges service with replicas in Amsterdam and US East, optionally Singapore. Railway selects nearby replicas and can serve from surviving regions. Note that this does **not** cover a Railway-wide outage.
3. PostgreSQL: evaluate supported HA product and independent off-provider physical/logical replication with WAL retention, replicas and validated backups. A Railway regional volume by itself cannot provide cross-provider disaster recovery. For cross-region promotion implement primary fencing, lease/quorum and DNS/connection cutover. Do not point independent writers at separate uncoordinated databases.
4. File/object assets: use durable shared object storage with versioning and tested cross-region copies; do not rely on instance filesystems.
5. Secrets: provision scoped secrets to the standby through an independent secret store; monitor rotation and avoid copying production credentials into Testing.

## Mandatory code prerequisites
- Convert `src/services/asyncJobs.ts`, `src/services/syncJobs.ts` and `src/services/adminEventStream.ts` from process-local Map/SSE state to durable shared job storage/event transport. Store progress, owner, heartbeat, completion, attempt and idempotency keys.
- Make the scheduled refresh, source sync, imports, MLOps, email/report scheduler and other crons single-leader or distributed-lock protected across replicas/providers. Verify the lock is on the active authoritative database and fails closed during loss of quorum.
- Audit database connection pooling and host configuration for a promoted primary; ensure old primary is fenced before enabling writes at standby.
- Readiness endpoint should verify app initialization and a lightweight DB query, while liveness should not trigger database failover by itself. Include an operator-only or non-sensitive region marker to inspect routing.
- Confirm sessions are stored in shared PostgreSQL or another cross-provider store and that cookies, host/origin checks, auth keys and callback domains work on both origins.
- Review schema changes, Prisma migration strategy, environment variable parity and ability to redeploy the same tested image/artifact on the standby.

## Implementation sequence (Testing first)
1. Inventory dependencies, domains and configs without reading secret values into logs; establish RTO/RPO goals, cost ceiling and data residency/POPIA requirements.
2. Provision a separate standby application deployment (no active scheduled jobs, no write traffic) and a continuously synchronized replica/backup system; implement monitoring and alerts.
3. Build shared job-state and leader-election prerequisites; load-test with two replicas before expanding to another region.
4. Rehearse: crash a replica; make Amsterdam unavailable; disconnect primary DB; interrupt sync halfway; restore from point-in-time backup; perform controlled promotion; cut over externally hosted standby; bring old primary back without split brain.
5. Only after successful drills, enable automatic Cloudflare-origin failover and document manual failback / rollback steps.

## Operational checklist
- [ ] Offsite immutable or protected backups and point-in-time recovery validated
- [ ] WAL replication lag and replica freshness monitored
- [ ] Idempotent sync and singleton cron behaviour demonstrated under multi-instance traffic
- [ ] Standby provider has required CPU, memory, build artifacts, environment and TLS
- [ ] Domain ownership, cross-origin security and cookie integrity validated on both origins
- [ ] Alerting detects app, DB and replication health separately
- [ ] RTO, RPO, promotion and failback drill results recorded
- [ ] Personal data cross-border transfers reviewed for POPIA contracts and safeguards

## Important caveats
Railway multi-region replicas share the Railway control/edge platform, so they are not independent provider redundancy. Railway deployment health checks do not replace continuous external monitoring. Physical PostgreSQL replication is not multi-master and asynchronous replication can lose the latest unreplicated writes. A cross-provider fallback must be serving-capable *before* a real outage.

References:
- https://docs.railway.com/guides/multi-region-api-failover
- https://docs.railway.com/databases/postgresql-ha
- https://developers.cloudflare.com/load-balancing/
