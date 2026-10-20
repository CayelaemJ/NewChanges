# Semantic score refresh: 30–60 second engineering gates (19 October 2026)

## Scope
These controls are committed to PR #169 only. **No dedicated worker is running**, no feature flags have been activated, and no deployments or production connections were changed.

### Why the former default cannot meet the target
Worst-case time is additive: source-change detection interval + SQL import time + worker start delay + score recalculation + signed object PUT/GET and publication + browser version-poll interval + network/render delay.
A 60s source check, a one-minute scheduled worker and 30s dashboard polling alone can take 150s in the worst case, **before** ingestion, calculation or storage.

The pure `estimateSemanticRefreshLatency` helper models these components conservatively. It is an estimate and cannot replace measured end-to-end timings. The normal default remains 60s source watching, a separately scheduled one-shot worker and 30s dashboard polling.

### Optional isolated latency pilot — ALL flags remain OFF
A safe faster test can be configured only by an authorized operator on existing **Testing** compute with isolated credentials:
- On the authoritative **Testing source scheduler**: `ENABLE_AUTHORITATIVE_INCREMENTAL_SCHEDULER=true`, `ENABLE_SEMANTIC_FAST_SOURCE_WATCH=true`, `SOURCE_CHANGE_POLL_SECONDS=15`. Keep `STANDBY_MODE=false` on the designated ingestion leader *only*. Faster source checks may significantly increase external SQL load, connection and Neon compute costs. Do not activate on Production or the Render standby.
- To persist semantic queue work on the source-ingest process: existing guarded `ENABLE_SEMANTIC_SHADOW_ENQUEUE=true`; additionally `ENABLE_SEMANTIC_QUEUE_WAKE=true`. After committed queue inserts, the system sends a best-effort PostgreSQL `NOTIFY` on `newchanges_semantic_refresh_ready` only when at least one job was inserted. The durable queue remains the source of truth, and failures of NOTIFY do not roll back or discard queue rows.
- On one **separate designated Testing worker** process: `ENABLE_SEMANTIC_EVENT_WORKER=true`, `ENABLE_SEMANTIC_SHADOW_WORKER=true`, `ENABLE_SEMANTIC_OBJECT_PUBLISH=true`, `ENABLE_SEMANTIC_RECOMPUTE=true`, plus the isolated database, a separate **direct non-pooler** Neon connection string in `SEMANTIC_LISTEN_DATABASE_URL`, and private S3 credentials. The listener rejects a pooled URL or a direct URL pointing to a different Neon database. Command: `npm run semantic:shadow:listen`. It LISTENs for wake notifications, processes a bounded set of queued jobs and sweeps every 60s for missed notifications. It exits on a dropped listener connection so a trusted supervisor can restart it. It is never embedded into Fastify. **No command has been run and no worker has been deployed.**
- On the isolated Testing dashboard only: `ENABLE_SEMANTIC_LIVE_NOTIFICATIONS=true`, `ENABLE_SEMANTIC_FAST_DASHBOARD_POLL=true` for 15s visible-tab publication polling. Without fast approval, enabled polling remains 30s; without notifications it remains off. Serving remains separately gated by `ENABLE_SEMANTIC_DASHBOARD_SERVING` and `ENABLE_SEMANTIC_CANARY_READ` and must not be enabled without genuine object/dataset verification.


**LISTEN connection requirement:** Neon transaction-pooled connection strings are unsuitable for a persistent `LISTEN` session. Use the directly connected endpoint matching the same DB host identity (minus the pooler suffix), database and `sslmode=require`. Keep this secret in an authorized runner, never chat or source control. No such Testing listener credential or process has been configured here.

**Cost warning:** a continuously connected PostgreSQL LISTEN client may keep Neon compute from autosuspending, even when the queue is idle. It should not be started on a personally funded service; existing company-funded compute and actual Neon consumption must be approved first. Fifteen-second source checks and browser polling also raise query volume. Idle operation must be measured for budget sign-off.

### Conservative example, not a benchmark
A modeled pilot might be 15s source detection + 5s ingestion + 1s queue wake + 10s recompute + 3s storage/publication + 15s browser check + 2s network = 51s. This leaves only 9 seconds of slack. A 25s recomputation fails the 60s budget even in this example. An interrupted listener can require up to the 60s fallback sweep and exceed the target.

### Acceptance test still needed
1. Authorize and configure `newchanges-neon-testing` restricted CircleCI context, trigger the **manual** Testing pipeline using `semantic_testing_e2e=true`. Existing tests cover real synthetic DB scores, scoped durable queue, CAS, rollback and an emulated storage-to-canary flow; they have not yet run.
2. For a real storage proof, run `semantic:e2e:real-storage-read` only against a **preexisting approved Testing bucket object** with pinned digest/length. The automated offline mock passing is not a real S3 proof.
3. In a fully isolated source+app+browser environment, record UTC timestamps for source commit, watcher detection, committed canonical row, enqueue/wake, worker claim, score persisted, S3 verified, manifest published, API retrieval and browser score visible. Calculate p50/p95 and worst-case under representative workloads, including ten feeds, historical corrections, retries, missed notifications, standby/failover and empty queue.
4. Fail sign-off if a source update does not change the persisted score or published object, if an incorrect tenant is exposed, if object retrieval fails, or if real source-to-browser latency exceeds 60s for the agreed acceptance condition. Report latency with caveats rather than representing modeled budgets as measurements.
5. Obtain explicit user approval before any merge, deployment, production flag changes or spending.

### Remaining blockers
- CircleCI Testing context and connection secret are not inspectable/triggerable through current connectors.
- No manual Neon score/queue/storage/publication integration run; the isolated DB currently has no generated score snapshot or publication pointer.
- No dedicated authorized Testing event-worker process nor actual LISTEN/NOTIFY measured wake time.
- No existing approved durable S3 Testing object plus safe read credentials.
- No live ten-feed source-to-browser acceptance test or real 30–60s measurement.
- No end-to-end disaster recovery or production release approval.
 
### Testing-only two-session LISTEN/NOTIFY proof (no worker or storage)
The isolated Neon project was checked on 19 October: PostgreSQL 18.6 supports `pg_notify`, synthetic source generation is ACTIVE, and no synthetic queue jobs existed. One **diagnostic** `pg_notify('newchanges_semantic_testing_probe',...)` was accepted by Testing; it emitted no application jobs or persistent table changes. Without a listener that query alone cannot prove delivery.

A new `npm run semantic:e2e:notify-probe` uses two short-lived PostgreSQL connections (direct session for `LISTEN`, Testing data connection for `pg_notify`) to measure three independent deliveries on the isolated `newchanges_semantic_testing_probe` channel. It accepts only `newchanges_testing_20261017` on Neon, requires BOTH `SEMANTIC_SYNTHETIC_E2E_APPROVED=YES_TEST_ONLY` and `SEMANTIC_NOTIFY_PROBE_APPROVED=YES_TEST_ONLY`, validates that the direct connection matches the data connection, and closes both clients after a bounded timeout. It never creates, claims, processes or deletes semantic refresh jobs and does not touch storage.

This has a **separate** optional CircleCI parameter `semantic_notify_probe=true` (default false), using restricted context `newchanges-neon-testing`. An authorized CircleCI administrator must install the masked `SEMANTIC_TESTING_DATABASE_URL` **and** `SEMANTIC_LISTEN_DATABASE_URL` (direct non-pooler endpoint for the same isolated database) before triggering it on branch `fix/semantic-refresh-period-validation-20261019`. Its output includes only three measured delivery durations and min/max—**not** production source-to-browser latency, an empirically reliable p95 or evidence a permanent worker is operating. The actual two-session run remains pending connection access.

The offline notification test runs in regular CI and asserts channel/payload matching, 100ms timeout behavior, publisher failures, and handler cleanup. Normal PR builds never run database-writing or diagnostic connection workflows.

### Executed isolated Neon queue transaction: real SQL evidence
A guarded, single-statement PostgreSQL transaction was executed directly against `newchanges_testing_20261017` using the ACTIVE synthetic generation. It inserted one synthetic `SemanticRefreshJob`, demonstrated `ON CONFLICT ("idempotencyKey") DO NOTHING` deduplication, changed its status to `RUNNING` with a lease and incremented attempt, completed it, and deleted that same row. A read-after query confirmed **zero remaining synthetic jobs**, score snapshots or manifests. No real employer data was changed.

The initial immediate-claim attempt exposed an important micro-timing edge: `availableAt` stores a rounded millisecond timestamp whereas `now()` retains microseconds. In the same transaction, the default timestamp can therefore be rounded less than 0.5ms into the future and the first claim finds zero eligible jobs. This can make a prompt `NOTIFY` wake incorrectly report an empty queue. A follow-up SQL rehearsal passed after applying a **one-millisecond eligibility tolerance**, now implemented in the actual `claimSemanticRefresh` query and locked down by the source safety regression check. Scheduled retry delays remain protected by `attempts < 5` and only shift by at most 1ms.

These direct database exercises prove the **SQL-level queue mechanics**, not the separately configured Node runner's Prisma call graph, real NOTIFY-to-LISTEN receipt or downstream score-to-browser latency. The manual Node integration remains an independent release gate.

The exact guarded single-statement rehearsal is preserved in `scripts/fixtures/semantic-neon-testing-queue-proof.sql`. Its `DO` block aborts atomically on a failed assertion, refuses non-Testing databases and foreign rows, and deletes only the synthetic probe job upon success. A separate read-only query must still confirm zero residual synthetic probe jobs after execution.


### 19 October storage and runner recheck
- Neon Testing branch `br-soft-mouse-b9rnii5t` reports **branchable storage enabled**, region `eu-central-1`, and path-style S3 support. **Its visible bucket list is empty**. This is not evidence of external-object durability and does not provide an existing object to verify. No bucket or object was created.
- CircleCI status checks remain accessible via GitHub, but the current connected tools cannot inspect restricted CircleCI contexts or trigger manual pipelines. Plugin discovery for `CircleCI` returned no available connector. An authorized operator must verify the `newchanges-neon-testing` context and configure Testing-only secrets out of band.
- Two-session LISTEN/NOTIFY measurement, the real Node score-delta rehearsal, and durable Testing S3 GET remain **unexecuted**. Existing Testing SQL confirms `pg_notify` support and exercised the synthetic atomic queue flow; it does not establish worker or browser latency.
- The dedicated event worker now continues another bounded claim pass after successfully processing five jobs, rather than unnecessarily waiting for a fresh notification or 60-second sweep when backlog already exists. This behavior is in normal CI regression checks; it has not been runtime-load-tested.
- Under the **no paid infrastructure** constraint, do not provision Neon Storage buckets or enable an always-connected listener. Choose an already-approved, company-funded Testing storage bucket and worker before attempting full integration.

### Restricted context activation order (no new infrastructure)
A dedicated **read-only** CircleCI workflow now provides a safer first gate: `semantic_context_readiness=true` (default false). On the feature branch only, it requires the existing restricted context `newchanges-neon-testing` with masked `SEMANTIC_TESTING_DATABASE_URL` and matching direct `SEMANTIC_LISTEN_DATABASE_URL`. It connects to both for read-only database identity checks, asserts ten reconciled synthetic cursors and refuses any synthetic active queue work or existing publication pointer. It does not use S3, start a worker, or mutate data. Its success does **not** establish real notification delivery or score freshness.

An authorized CircleCI operator should run in this order: (1) read-only `semantic_context_readiness=true`, (2) diagnostic `semantic_notify_probe=true` to measure three actual deliveries on a separate channel, and only after both pass (3) `semantic_testing_e2e=true` to rehearse synthetic score, queue, publication and canary, with restoration. Trigger only one optional pipeline parameter at a time; never paste connection strings into pipeline parameters, PR comments or chat. Ordinary PR pipelines still run only code and browser checks.

Storage inventory from the existing isolated Neon branch is unchanged: object storage is supported, but its current bucket list is empty. The guarded `semantic:e2e:real-storage-read` needs an already-existing, approved Testing object and credentials. Do not create a new bucket or upload objects without separate approval for the provider and its costs.


### CircleCI restricted context launch checklist — 20 October
The operator must confirm project permissions for `newchanges-neon-testing` in CircleCI, restrict it to the approved feature branch and authorized personnel, and set masked `SEMANTIC_TESTING_DATABASE_URL` and `SEMANTIC_LISTEN_DATABASE_URL`. The direct listener URL must target the **same Testing database**, use TLS and bypass the Neon transaction pooler. Do not put credentials in pipeline parameters, job logs, GitHub issues or chat.

Run three **separate** feature-branch pipelines, selecting exactly one boolean parameter each time while leaving the other two false: first `semantic_context_readiness=true` (read-only dual-connection fixture checks), then `semantic_notify_probe=true` (three diagnostic notifications, bounded timeouts), then `semantic_testing_e2e=true` (controlled synthetic data-writing tests with cleanup). Every manual job now refuses combined Testing flags. This avoids same-pipeline overlap; an administrator must **also avoid triggering separate manual pipelines simultaneously**, as CircleCI flags cannot lock separate pipelines against each other.

Before the final data-writing pipeline, confirm zero preexisting active synthetic queue jobs and publication pointers. After it completes, check synthetic journey savings is back at 10,000 cents, no synthetic jobs/manifests/pointers/audit records remain, and baseline score is consistent. If cleanup fails, **do not rerun automatically**; inspect only isolated Testing state before any repair.

Do not start the permanent LISTEN worker to run these acceptance scripts. An enabled Neon object-storage feature with **zero buckets** does not satisfy the real S3 durability gate. Do not create a bucket or paid resources under the current restriction. The full SQL source-to-browser 30–60-second acceptance test is still pending.


### 20 October: exclusive manual acceptance suite lock
The optional `semantic_testing_e2e=true` workflow now invokes `npm run semantic:e2e:suite` instead of launching six separate unguarded npm commands. The wrapper first verifies the exact Neon Testing database, acquires a session-level `pg_try_advisory_lock`, and only then runs preflight, synthetic score delta, queue, metadata publication, emulator storage publication and full score-to-canary stages in sequence. A second simultaneous data-writing suite fails closed rather than racing against the same synthetic fixture. The wrapper releases the lock and closes the PostgreSQL connection in `finally`. This guards **data-writing suites only**; the read-only context probe and diagnostic notification test are intentionally independent and do not modify application tables.

This lock has been code-reviewed and covered by static regression assertions, but the Node suite has **not yet run** against isolated Neon. An authorized operator must configure the restricted CircleCI context and run the read-only readiness job before the data-writing suite. Verify synthetic fixture restoration after completion, especially if a child stage fails. The lock is not a substitute for independent worker or pipeline runtime observation.
