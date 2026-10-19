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
