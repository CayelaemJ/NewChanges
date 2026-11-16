# The Fixer — Data Sources & CDC Control Centre

**Last updated:** 16 November 2026.
**PR:** #237, branch `feature/aws-rds-mysql-synthetic-cdc-20261106`.
**Status:** UI/API groundwork committed, not production CDC activation.

## User-facing goal

The Fixer should let an administrator connect a second database without
replacing the first, understand what changes and when, and use data to build
dashboards without duplicating an entire reporting warehouse in the app
database. The desired interface is:

```text
Administration
└── Data Sources & CDC
    ├── Connection inventory      [implemented, safe projection]
    ├── Existing integration       [implemented legacy one-active]
    ├── Candidate connections      [implemented staging inventory]
    ├── CDC readiness              [implemented, blocked status]
    ├── Change timeline            [planned: needs real event metadata]
    ├── Source health and costs    [planned: live telemetry not wired]
    ├── Schema discovery/mapping   [offline modules exist, UI not wired]
    └── Dashboard report builder   [planned: source-side aggregates]
```

Existing reporting pages stay unchanged until source-side dashboard
aggregation has been independently verified for period, site, income,
history, employer scoping, deletion and exact metric parity.

## What PR #237 now exposes

**React admin route:** `/react/admin` → **Data sources & CDC**.
The page makes one admin-only same-origin read to
`GET /api/admin/data-sources/overview` and refreshes every 60 seconds.
The page is responsive and contains status cards, a configured source
summary, staged-candidate list, CDC blockers and supported connectors.

**API:** `src/server.ts` calls the existing `requireAdmin` helper,
fetches the safe config and existing staged `SourceGeneration`
records, and projects them through the pure
`src/services/dataSourceControlCenter.ts` mapper.

The returned JSON deliberately **does not include** SQL hosts,
credentials, connection strings, vault references, raw source rows,
source view definitions, external endpoint labels, failure text or
unreviewed source metadata. The new **Existing source watcher activity**
section displays only actual sanitized process-local timestamps,
last outcome, poll duration, poll count and changed-feed count. It
must never be labelled a real-time binlog CDC feed. A candidate's opaque safe ID and
status are allowed for administrative display. The existing source
watcher's status is labelled **this-process / legacy source watcher**,
not AWS binlog-CDC lag or cross-worker health.

**Registration action:** **Stage a database** links to
`/admin#live-integration`, the existing connector form with
candidate testing and staging. That does not automatically change the
active source. It is not yet a true simultaneous multi-source runtime.
`SourceGeneration` supports staged candidates and an approved
equivalent-source cutover, not multiple active datasets.

**Status labels:** an enabled integration is called
`ENABLED_LEGACY_IMPORT`, **not** proven online; a validated staged
generation is not live; the CDC pilot is explicitly
`BLOCKED_NOT_DEPLOYED`, independent of the legacy source watcher.
No fabricated RDS lag, CloudWatch cost, binlog throughput, event
volume, replication replay horizon or consumer health appears.

## Reuse existing schema-mapping infrastructure

The codebase already has:

- `canonicalSchemaDiscovery.ts`: a bounded, read-only
  `information_schema` metadata query planner for MySQL,
  PostgreSQL and SQL Server.
- `canonicalSchemaMapping.ts`: validation and preview of table
  and column mappings to the ten canonical feeds.
- `canonicalMappedKeysetSql.ts`: a bounded, typed mapped-feed
  extraction query compiler (part of the separate staging prototype).
- `canonicalMappedStagingRunner.ts`: isolated candidate/fixture
  staging code, **not an approved automatic production cutover**.

This means schema **mapping planning** already exists. It does not
mean the system can discover any new database, approve an inferred
mapping, stream CDC for it and deploy its dashboard without oversight.

## Plug-and-play lifecycle to implement next

```text
1  REGISTER         Select MySQL / PostgreSQL / SQL Server / HTTPS API
2  TEST             Validate TLS, permissions, identity and read-only access
3  DISCOVER         Enumerate schema/table/column metadata under a hard budget
4  MAP              Map arbitrary source fields to canonical metrics or feeds
5  REVIEW           Admin/data owner approves field lineage and PII scope
6  INITIALIZE       Verify consistent snapshot and source-backed aggregation
7  CDC STRATEGY     Select safe event stream (or bounded polling fallback)
8  ACTIVATE         Explicit, audited activation of an independent source ID
9  MONITOR          Health, lag, replay horizon, cost, load and quality
10 REPORT           Publish durable dashboard version after successful refresh
```

Each registered source requires **stable source ID**, owner/tenant ID,
connector type, read-only credentials stored in an encrypted vault,
namespace/schema, allowed objects, a versioned mapping manifest,
an approved change-capture mode, budget and source-specific health.
Do not reuse table names, primary keys, checkpoints or
`employer_ref` across sources without an explicit reviewed mapping.

**No automatic inference** of employer identity from a foreign
database's column. The default is fail closed.

### Suggested connector contracts

| Source | Existing read integration | Candidate CDC implementation | Security dependency |
|---|---|---|---|
| MySQL / MariaDB | SQL adapter + canonical views | MySQL ROW/FULL binlog | Global binlog exposure review, retention |
| PostgreSQL | SQL adapter + canonical views | Logical replication or authorized polling | Publication/slot permissions, WAL retention |
| SQL Server | SQL adapter + canonical views | SQL Server CDC or Change Tracking | Licensing/edition, privileges, retention |
| HTTPS API | Bearer-token API adapter | Idempotent webhook or rate-limited polling | Signature verification, throttling |

These are **target strategies**, not claims that the app already
supports running each CDC connector.

## Dashboard information architecture

**Data sources**: connection inventory, lifecycle state, environment,
last successful query, staged candidate changes and safe launch controls.

**CDC monitor**: for each approved source/feed, show received event
rate, XID/checkpoint (opaque metadata), most recent commit time,
consumer lag, replay retention, dead-letter count, duplicate/replayed
event rate and last acknowledged published generation. Show
`NOT_INSTRUMENTED` rather than fabricated zeros before a live worker
and durable metrics are connected.

**Analytics explorer**: select one or more authorized source IDs,
employer, report feed, period and approved metric; show
lineage/quality and last completed publication. Aggregate on source
when it can meet query budgets, avoid bulk row replication into
PostgreSQL. Multi-source joins require explicit identity mapping
and budgeted federation/materialization, not accidental cross-tenant
joins.

**Cost and performance**: track read queries per minute, average/p95
latency, source pool saturation, free storage, binlog volume and
retention, cloud database spend, CDC processed events, cache hit
ratio and tenant-specific query budgets. Telemetry must use
actual source/platform measurements and be marked stale if no longer
updated.

**Operator controls**: test connection, review mapping, stage
candidate, pause affected consumer, replay from verified checkpoint,
review schema drift and approve cutover. Never provide a single
click that silently replaces the current database or replays a
missing binlog gap.

## Technical architecture for simultaneous multi-source

The existing Prisma `IntegrationConfig` is a singleton
(`id: default`) and serves one active source.
`SourceGeneration` handles staging. Converting that to a true
multiple-active-source control plane requires a *separate reviewed
schema migration* for a persistent registry; the new read-only
overview API deliberately does not make such a migration.

The future registry should hold **metadata only** in PostgreSQL:
`SourceConnection`, `SourceMappingVersion`,
`SourceCDCCheckpoint`, `SourceFeedGeneration`,
`DashboardPublication`. Raw reporting facts remain at their
authorized source. The connector adapter should expose strict
`discover`, `validate`, `readAggregates`, `changeStream`
and `health` interfaces; adapters enforce their own least
privilege, timeouts, quotas and schema allowlists.

A CDC stream should emit *metadata-only* normalized change
notifications (`sourceId`, `feed`, opaque transaction position,
operation, generation) and use an atomic checkpoint + notification
commit. An employer's dashboard should be re-read through an
approved source-specific aggregation plan. Only the successfully
completed version is published to authorized clients by SSE/polling.

## Production release and PR #237 completion

**Already verified by operator:** disposable MySQL/Python CDC tests
**118/118 PASS**; RDS metadata audit on ten canonical views and
ROW/FULL binlog configuration; source-to-view physical identity
gap (0/10 exposed).

**New PR checks, run before sign-off:** `npm run check:cdc-dashboard`
(37 Node tests: 10 reader + 17 publisher + 10 admin control centre),
`npx tsc --noEmit`, `npm run check:frontend:typecheck`,
existing frontend build and CircleCI verify/security checks.
The Node tests and new frontend are not yet verified in a completed
runtime build in this conversation.

**Hard live CDC blockers:** RDS
`mysql.rds_show_configuration` reported
`binlog retention hours=NULL`, which is zero hours guaranteed
for external CDC recovery. RDS binlog retention must be
approved and storage-monitored before changing it. The snapshot,
global replication privilege/privacy review, durable metadata
checkpoints and authenticated direct-source dashboard
aggregation are not yet implemented/approved.

**Not done / never claim:** the control centre is not a
fully connected second database; the admin overview does not
open RDS or report live CDC events; no durable multi-source
registry exists yet; no feature is activated by this UI; no
production dashboard has been rebuilt against MySQL; no AWS
setting, data, credential, external service or permissions changed.

## How to view it

After the branch has been deployed to a safe preview and the
new tests pass, open `/react/admin`, sign in as an authorized
admin and select **Data sources & CDC**. Use **Stage a database**
to open the legacy candidate connection/test/stage form.
The existing source remains active until an explicit,
approved cutover. The production app will not show this tab
until code is deployed.
