# Shared Neon PostgreSQL: production cutover and disaster recovery (2026-10-13)

## Current verified state
- Railway Production service **NewChanges** and Render Free service **newchanges-standby** are configured with the SAME Neon PostgreSQL 18 database `newchanges`, project `wild-base-70222190`, Frankfurt region.
- Railway deploy `fe00ff9f-4e99-40c0-9487-c91b941fded0` succeeded. Its Prisma startup log explicitly identified `newchanges` on the Neon pooler.
- Render deployment `dep-db71qdc9v7es73a6ocg0` reached live with Neon main connection configured; independent authenticated read/write workflow test remains outstanding.
- Initial source was Railway PostgreSQL service `Postgres-h_Ck`, database `railway`, 590,886,591 bytes, 49 tables and four users.
- A one-off PostgreSQL 18 `pg_dump -Fc`/ `pg_restore` copied all 49 tables and four users, followed by the append-only-event reconciliation: 2 missing `AnalyticsEvent` records and 81 additional `DataAccessEvent` records were inserted by ID. **These are snapshot and later delta actions, not continuous replication**.
- Neon manual snapshot `newchanges-initial-railway-migration-2026-10-13` exists. A temporary custom-format backup in the migration job was removed on job exit: **no independent offsite backup artifact was retained**.
- One-off Railway migration service was deleted after clearing its credentials.
- Railway current production HTTP log sample: 81/81 HTTP 200, but this does NOT prove login, permission, or state-changing parity.
- Render `STANDBY_MODE=true` suppresses its startup background schedulers; it does not stop web request writes. Only Railway should operate ingestion, daily refresh, report scheduling, and automated jobs while it is primary.

## Topology

```
                 ┌────────────────────┐      ┌──────────────────────┐
Users ── DNS ──> │ Railway NewChanges │      │ Render standby       │
                 │ Active scheduled   │      │ STANDBY_MODE=true    │
                 │ processing         │      │ No scheduled writes  │
                 └───────────┬────────┘      └──────────┬───────────┘
                             └──────────┬───────────────┘
                                        ▼
                              Neon PostgreSQL 18
                              newchanges (one primary)
```

Both apps read/write the same transactional Postgres database. There is **no periodic sync**, replication lag, or conflict between independent app databases. Changes in application memory, local files, cookies, ephemeral session caches and build versions are NOT automatically synchronized. Verify that both apps use the same session-signing secrets and deploy compatible application versions before routing actual users between them.

External MySQL/MSSQL/API ingestion credentials and upstream data stores are **not being migrated**.

## Failover readiness gates (NOT YET COMPLETED)
1. Add database-aware `GET /ready` (PR #100) to main; configure Railway and Render HTTP healthchecks to use it, not liveness-only `/health`.
2. Configure Render with compatible build/commit, authentication/session secrets, mail providers, and asset storage. Its free tier may sleep/wake and has no immediate-recovery SLA.
3. Execute authenticated read and WRITE roundtrips with test accounts on both sites, including admin permissions, themes, dashboards, data export and scheduler uniqueness.
4. Select an independent health-aware traffic router (e.g. paid/free-with-limitations Cloudflare Load Balancing or external monitor + DNS API), own domain and TTL. **Merely having two links is not automatic failover**. Confirm plans/fees and ownership before changing DNS.
5. On failover, make sure only one instance executes refresh/ingestion/scheduled tasks. Failback requires identical app version and secrets and no duplicate jobs.
6. Establish tested off-provider, encrypted, independently restorable backups with retention, then deletion of old Railway databases can be considered.
7. Configure monitoring, alerting and prove failover and failback using planned staging outage.

## Railway cost inventory (2026-10-13)
- Production: `Postgres-h_Ck`, original source with a 5000 MB volume. Do NOT delete until an independently restorable backup and dependency audit are complete.
- Testing: separate `Postgres` with its own 5000 MB volume, consumed by or co-located with `Testing-EFS`. Treat as independently owned, do not delete from a production cutover.
- Playground: separate `Postgres-oTP9` with its own 5000 MB volume and `calm-healing`. Do not delete without checking its reference variables and test data.
- MySQL services in Testing are external/source-integration concerns and out of scope.
- Database service deletion does not necessarily delete attached Railway volumes or stop their storage bills; examine service and volume separately in the console.

## Outstanding issues and follow-up
- Verify actual source-to-Neon parity under a frozen writer window before any destructive cleanup; the earlier count parity was not a concurrent atomic snapshot.
- Remove drifted Railway `DATABASE_URL` reference variables from unrelated environments only when that environment is migrated/tested.
- Move Render to matching main release (its branch was cut before later app changes). PR #98 brings `STANDBY_MODE` to main.
- No claim of SOC 2, guaranteed recovery-time objective or active-active failover without evidence.
- Rotate privileged DB connection secrets after DR work and use least-privilege database roles and pooled connections where appropriate.

## PR disposition
- #97: job visibility/false-completion correctness; merge only after current CI and review.
- #98: standby mode/Render infra; intended for integration with app main.
- #99: identity-only migration tool superseded by complete PostgreSQL migration; keep out of production.
- #100: full consolidation runbook, read-only sizing, database-aware readiness.
- #101: migration scripts and read-only parity / event reconcile; tools are **manual one-shot**, not an always-on app service.
