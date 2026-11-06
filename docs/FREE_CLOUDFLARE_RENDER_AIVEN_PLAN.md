# The Fixer: zero-new-cost Cloudflare + Render plan

**Status: CANDIDATE ONLY. Not deployed; production still uses the existing host and Neon.**
**Budget: no additional paid subscriptions.** This plan deliberately avoids Cloudflare Containers and all automatic resource creation.

## Architecture

```text
Browser / mobile
   -> Cloudflare Free Worker (public HTTPS entry, simple routing only)
       -> Render Free web service (the original Node 24 Fastify/Prisma app)
           -> Aiven free PostgreSQL 18 (dedicated restricted runtime role)
           -> existing optional external MySQL / mail integrations
```

The Worker serves the original HTML, React build artifacts, REST APIs, admin console and login indirectly through the existing Fastify backend, preserving same-origin cookies and application routes. It does **not** split/duplicate assets or port the application to Workers. Cloudflare can handle incoming edge requests while the Render backend sleeps, but cannot make the sleeping backend process continuously available. The Worker returns HTTP 503 with Retry-After when Render is unavailable. This is a deliberate limited-availability compromise, not continuous 24/7 production.

## Platform constraints verified 2026-11-05

- Cloudflare Containers API explicitly rejected this account: Workers Paid required. No billable change was made.
- Render documents that free web services sleep after 15 minutes idle, spin up in approximately a minute, have ephemeral local storage, can restart, and have limits on free hours, bandwidth, pipeline minutes, and service-initiated traffic. Not a durable always-on production guarantee. See https://render.com/docs/free.
- Oracle Always Free compute is a possible later option, not provisioned. Region capacity and idle reclamation are material risks: https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm.
- Aiven's 1 GB free database is already populated with 57 public application tables; snapshot stale. The final delta-sync tests belong to PR #217, not this edge-only branch.

## What's implemented (isolated GitHub branch)

- `cloudflare/free-edge/worker.mjs`: restricted HTTPS `*.onrender.com` origin proxy, canonical hostname allowlist, spoofed forwarding-header removal, private edge-to-origin secret, no caching, secure cookie forwarding, same-origin redirect rewriting, no external secrets or credentials, disabled by default. Does not create Cloudflare paid resources.
- `wrangler.newchanges-free.jsonc`: **no public route or workers.dev subdomain**, no database secrets, `NEWCHANGES_FREE_EDGE_ENABLED=false`. This is deployment-ready configuration only after staging/approval.
- `render.free-candidate.yaml`: separate Render Free backend candidate, no automatic deployment, `STANDBY_MODE=true` and no database secret value. The existing `render.yaml` standby configuration remains unchanged.
- `tests/cloudflare-free-render-edge.test.mjs`: offline request-routing and security regression tests.
- `.github/workflows/free-edge-manual.yml`: manual GitHub Actions workflow targeting **self-hosted Linux runner** only, with offline tests and Docker build. Never accesses Neon/Aiven or deploys anything.

## Safe execution order

1. Run `node --test tests/cloudflare-free-render-edge.test.mjs` on the new branch. Build the unchanged backend with `docker build -f Dockerfile -t newchanges-free-backend:preflight .`.
2. Select the intended Render workspace, check its current free allocation, and confirm whether another free app would exhaust its 750 included monthly hours. No new service was created. Only after checking available capacity, manually create a separate candidate via `render.free-candidate.yaml`. Render Blueprints generally use `render.yaml` by default: select/point explicitly to this separate file instead of modifying the existing standby configuration.
3. Test with a **disposable synthetic database**, without live Neon or Aiven credentials. `STANDBY_MODE=true` is not a security boundary, and cannot alone guarantee read-only staging behavior. Add controlled auth / MFA / tenant E2E and check startup, backend assets, database pooling, SMTP, MySQL, and file persistence. Deploy credentials using Render protected environment settings only.
4. Before attaching the public Cloudflare custom domain, verify the free Worker can route to the candidate through a protected non-production hostname and handles cold starts, login cookies, redirects and streaming. No Cloudflare route has been created by this PR.
5. Read the separate guarded Aiven synchronization runbook in PR #217. Arrange a maintenance window, stop **every** source writer/job/ingester, take a verified independent encrypted backup, run only reviewed final delta on the frozen database, and compare all rows to the checkpoint.
6. Configure the Render production runtime with the restricted Aiven database user, required encryption secrets, and verified environment variables. A test with the same DB is only permissible after single-writer fences are established. Install health/error monitoring. Ensure retention, cross-border transfer authority, MFA and authorization have passed.
7. Switch Cloudflare entrypoint to the **one** active Render backend, open the public route, and make the original application read-only/offline. Confirm production is writing **only** to Aiven. Rollback requires reverse reconciliation of post-cutover writes.
8. Use Cloudflare Free monitoring and local self-hosted CI; do not promise reliable scheduled jobs on a sleeping Render Free web service. Promote backend to continuously running **only** after a genuinely available R0-capable VM with tested monitoring, storage and backups is in place.

## Local verification

```sh
git fetch origin
git worktree add ~/NewChanges-free-edge origin/feat/free-cloudflare-render-primary-20261105
cd ~/NewChanges-free-edge
node --test tests/cloudflare-free-render-edge.test.mjs
node --check cloudflare/free-edge/worker.mjs
docker build -f Dockerfile -t newchanges-free-backend:preflight .
```

No `DATABASE_URL` or live production credentials are needed for these static/synthetic steps. If a worktree of that name exists, do **not** overwrite it.

## Explicit go-live sign-off

Cloudflare free frontend success is NOT the same as entire application success. Mark production complete only when the end-to-end full application, Aiven sole-writer state, MFA, tenants, MySQL/email dependencies, backup restore, error monitoring, availability expectations, and rollback have all been verified.

Do **not** delete Neon, enable paid Workers Containers, migrate secrets into public Pages assets, or merge/deploy this branch blindly.


## Protecting the public Render address

The Render URL is reachable directly, bypassing any Cloudflare WAF rules. To reduce that bypass risk, `src/server.ts` now enforces an optional constant-time shared-token guard (implemented in `src/services/cloudflareOriginGuard.ts`). The new Render candidate blueprint enables `NEWCHANGES_EDGE_ORIGIN_GUARD_ENABLED=true` and requires the private `NEWCHANGES_EDGE_ORIGIN_SHARED_SECRET`, which must be at least 32 characters. Cloudflare Worker refuses to proxy unless that same token is stored **as its encrypted secret**. The Worker removes any caller-provided token header and injects its own. `/health` and `/ready` are exempt so Render's platform checks can work; they must not expose sensitive state.

Do **not** commit the actual token, embed it in Wrangler `vars`, copy it into build arguments or paste it into chat. Configure it through protected environment settings on Render and an encrypted Cloudflare secret. The original application's production environment is unaffected while the guard is not enabled there.

This addresses direct-origin requests but is not a replacement for proper user MFA, per-user authorization, tenant isolation, CSRF protections or application rate limits.


## Confirmed Render workspace inventory and billing gate (2026-11-06)

Operator explicitly confirmed workspace `My Workspace`. Read-only Render API inventory found **13 web services, all on the Free compute plan**. The Fixer already owns `newchanges-mfa-isolated-staging` (Free, Dockerfile.mfa-staging, manual deploys, separate MFA role) and `newchanges-standby` (Free, main branch, auto-deploy). Neither was changed. Do not repurpose the MFA staging service without its tests and isolated data safeguards; do not change standby's branch or live database credentials.

Render's published limit is **750 Free instance hours per workspace per calendar month**, pooled across all running Free web services; sleeping services consume no hours. Exhaustion suspends **all** Free web services in the workspace, not just this candidate. Outbound bandwidth and build-pipeline overages can cause billing when a payment method is present. See https://render.com/docs/free. The connector exposes service inventory and performance metrics but **not the workspace Billing → Monthly Included Usage balance or payment-method/spend-limit settings**. Therefore do **not** create or deploy another Free service until the operator verifies the remaining monthly instance hours, outbound bandwidth, pipeline minutes and applicable zero-spend limit. Creating a service with empty database credentials would only produce a broken publicly reachable backend and consume resources.

Next safe gate: operator checks Render dashboard Billing → Monthly Included Usage and account spend settings. Run any remaining tests locally, with no extra Render service until capacity is confirmed. Actual public staging deployment stays blocked pending isolated disposable database availability and origin secret provisioned in the protected stores; no use of Neon production credentials for public staging.


## Reproducible full-backend runtime check (2026-11-06)

The operator successfully confirmed on WSL Ubuntu that the built Docker image starts the full Fastify server with an isolated synthetic PostgreSQL 18 container: `/health=200` and `/ready=200`, followed by cleanup. A new deterministic `scripts/free-backend-runtime-smoke.sh` automates that verification in CI. It creates an `--internal` network (no external egress), publishes **no ports**, uses only synthetic credentials, and always destroys both containers and the network via exit trap. It also **enables the Render origin guard** and checks `/version` is rejected without the edge token (403) and accepted with the token (200). Database tables are intentionally not initialized, so this is startup/connectivity/security-only evidence.

To rerun against the already-built image:
```bash
cd ~/NewChanges-free-edge
git fetch origin
git merge --ff-only origin/feat/free-cloudflare-render-primary-20261105
node --test tests/cloudflare-free-render-edge.test.mjs
bash -n scripts/free-backend-runtime-smoke.sh
bash scripts/free-backend-runtime-smoke.sh
```

The manual-only self-hosted Linux runner workflow also invokes this script after building the Docker image. No Render deployment, Neon/Aiven access or DNS switch is required.


## Render planning result (2026-11-06)

Operator reports approximately 725/750 remaining monthly shared Free instance-hours. The workspace already contains **one Free Render PostgreSQL 18 instance**, `newchanges-mfa-synthetic-staging-db`, expiring 2026-11-29. Render only allows one Free PostgreSQL database per workspace. Do **not** create a second database, repurpose the MFA test database, or point a public staging web service at production Neon/Aiven.

A non-deploying Render Blueprint planning call completed successfully (outcome `planned`, no resources applied):
- Blueprint `exs-dbmnv961egvs73d5i6t0`, `autoSync=false`, `create_new`
- Proposed **Free** web service `newchanges-free-backend-candidate-zaws`, Frankfurt, Dockerfile, manual deploys only
- Plan: https://dashboard.render.com/blueprint/exs-dbmnv961egvs73d5i6t0/sync/exe-dbmnv9m1egvs73d5i7t0
- Requires operator to supply protected manual environment settings: `NEWCHANGES_EDGE_ORIGIN_SHARED_SECRET`, `DATABASE_URL`, `PUBLIC_BASE_URL`. Do not insert empty values or copy production credentials to bypass this gate.

**Status: PLAN ONLY, not approved.** Applying a Blueprint requires review and explicit operator approval. Before approval, establish a disposable *independent* PostgreSQL database and a staging domain. The existing MFA database is not shared by default. Aiven free might offer additional databases within a service, but sharing a production database server requires separate role and database isolation, safety review, capacity check and explicit consent. A nonworking production-like public service is not a valuable smoke test. No Cloudflare paid plan or live traffic change is intended.


## Read-only Aiven runtime capacity observation (2026-11-06)

Aiven service `the-fixer-postgres` was confirmed `RUNNING` on free-1-1gb, PostgreSQL 18.6. A read-only query returned `pg_database_size('defaultdb') = 198 MB`, `active_connections=14`, and `max_connections=20` at the observation time. Connection count is a fluctuating snapshot, not a guarantee of six spare slots. **Do not** attach a second live/staging application, create a staging role, run synthetic DDL, raise pool sizes, or provision a second database on this production-targeted free Aiven instance as a workaround. It could exhaust its limited 20-connection budget.

## Privacy-hardened readiness (2026-11-06)

The free-candidate Render health check now uses public `/health` only. When the optional private Cloudflare origin guard is enabled, the database-revealing `/ready` endpoint requires the shared token, just like login and dashboard requests. The synthetic Docker smoke test verifies `/health=200`, direct `/ready=403`, token-authenticated `/ready=200`, direct `/version=403`, and token-authenticated `/version=200`. These new assertions still need to be rerun after updating the local worktree; older passing results do not verify this specific hardening revision.

The Render Blueprint plan has been refreshed successfully using the current free-hosting branch and continues to propose one Free web service, `healthCheckPath=/health`, no automatic deploys, and three manually supplied protected env settings. **Plan only, not approved or deployed.**


## Direct-to-production decision and verified rebuilt smoke (2026-11-06)

The operator opted to **skip a separate staging app/database** and prepare a controlled production cutover using Cloudflare Workers Free, Render Free, and the already-migrated Aiven PostgreSQL 18 service. The prior Render Blueprint was planned but **not applied**; do not approve its staging configuration unchanged. The existing Render standby and MFA-staging resources remain untouched.

After rebuilding the local application Docker image, the operator confirmed the revised isolated runtime smoke **passed**: public `/health=200`, direct `/ready=403`, token-authenticated `/ready=200`, direct `/version=403`, and token-authenticated `/version=200`, with synthetic PG18 and container cleanup. The earlier failed smoke used a stale image and is superseded. This remains a local runtime proof, not a full production exercise.

### Outstanding controlled production cutover gates

1. Prepare a Render **Free** production candidate with auto-deploy off and the approved current Docker commit. Do not connect to or write Aiven until the source-fencing and final-delta procedure is ready. Configure private `NEWCHANGES_EDGE_ORIGIN_SHARED_SECRET`, canonical URL, secure cookies, and limited database pool. Never paste secrets into GitHub or logs.
2. Confirm Aiven runtime account has the intended least-privilege access and that the service has connection headroom. The prior read-only snapshot showed 14/20 current connections, so additional pool connections need explicit limits. Do not enable a second ingestion leader.
3. Before migrating live traffic: verify recoverable encrypted backup of Neon and Aiven, source-write fencing, final transactional delta, 57-table reconciliation including audit/session activity, then enable the new writer only after old production writes are stopped.
4. Verify login, forced administrator MFA, user/tenant authorization, dashboard, administrative operations, background-job leadership, and rollback on the new database **before** sending end-user traffic. For a direct migration these checks occur within a controlled maintenance/cutover window, not in a separate persistent staging deployment.
5. Enable the Cloudflare free-edge route only after the backend passes authenticated and database tests, and retain Neon read-only as rollback evidence. Rollback must never cause old and new systems to write simultaneously.

**Do not claim production cutover completed until the above gates have actual evidence.** Free Render's idle sleep behavior remains a production reliability limitation, and a normal web service cannot guarantee continuous scheduled operations.


## 2026-11-06 direct-production free Render plan (supersedes separate staging)

The operator chose direct controlled production migration, with separate staging **not required**. Production still stays on the original host and Neon until final verification. Do not use or approve the earlier staging-only Blueprint as a shortcut.

- New `render.free-production.yaml` provides fail-closed Render Free Docker production candidate, `STANDBY_MODE=true`, `TRAFFIC_SAVER_MODE=true`, incremental scheduler explicitly disabled, `/health` liveness, Cloudflare origin guard enabled, private `DATABASE_URL`, `PUBLIC_BASE_URL`, and origin token unset until protected injection. No auto-deploy or paid resources.
- `tests/free-production-cutover-contract.test.mjs` checks the free plan, safe env defaults, no committed database URLs, and Cloudflare route disabled. Manual self-hosted workflow now runs it.
- Render API accepted **planning only** as new Free service `newchanges-free-production-3j5p`, Blueprint `exs-dbmohf6gekts73e32sug`, autoSync false; plan: https://dashboard.render.com/blueprint/exs-dbmohf6gekts73e32sug/sync/exe-dbmohfegekts73e32te0. **Not approved/deployed**. Requires protected manual secret values (Render never received them from Git).
- Local revised Docker runtime smoke succeeded per operator after rebuilding current image; the new direct-production contract test needs operator rerun.
- Cutover blocker: independent verified backup and restoration plan, proven old-writer fence, final audited Neon-to-Aiven delta and 57-table reconciliation, restricted connection-pool capacity, production MFA/authorization checks, secure Render env and Cloudflare route. The existing Aiven service showed 14 of 20 connections during a point-in-time inspection. No final delta executed.
- Do not use Aiven admin credentials for runtime. Do not turn on `STANDBY_MODE=false` until all old writers are fenced and final data is reconciled. When the release is eventually enabled, retain `TRAFFIC_SAVER_MODE=true` until a reliable separate scheduler and single-authoritative-writer system exist. Free Render has idle sleep and is unsuitable for guaranteed on-process cron execution.

To locally validate the newest committed release contract:

```bash
cd ~/NewChanges-free-edge
git fetch origin
git merge --ff-only origin/feat/free-cloudflare-render-primary-20261105
node --test tests/free-production-cutover-contract.test.mjs tests/cloudflare-free-render-edge.test.mjs
```


## Actual Free production Render service provisioned (2026-11-06)

The operator asked to move the controlled production migration forward. A **Free** Docker web service was created in confirmed Render workspace `My Workspace`, without paid plan, database connection URL, Cloudflare secret or traffic routing:
- Service `newchanges-free-production`, ID `srv-dbmokqm7bikc73bk2h00`, Frankfurt.
- Dashboard: https://dashboard.render.com/web/srv-dbmokqm7bikc73bk2h00
- Public address: https://newchanges-free-production.onrender.com (do **not** send users there yet).
- Initial deploy `dep-dbmokrm7bikc73bk2jug` from commit `ce6404f06c96e3627b6668d369c55a26be3ddaeb` was **update_in_progress at last observation**, so service health is NOT confirmed.
- Auto-deploy disabled, `STANDBY_MODE=true`, `TRAFFIC_SAVER_MODE=true`, `ENABLE_AUTHORITATIVE_INCREMENTAL_SCHEDULER=false`, `NEWCHANGES_EDGE_ORIGIN_GUARD_ENABLED=true`, `COOKIE_SECURE=true`, `TRUST_PROXY=true`. No DATABASE_URL or origin shared secret installed. As a result, backend authorization fails closed and DB-backed readiness cannot yet work. A reachable HTTP health endpoint is not proof of DB readiness.
- The direct `create_web_service` API did **not** expose Render's healthCheckPath setting, so the service currently has an empty platform health-check path (but the Dockerfile has its own `HEALTHCHECK /health`). The separate production Blueprint remains unapproved; do not approve it because it would create a duplicate service. Set the Render platform `/health` health-check path through an appropriate supported configuration mechanism before go-live.
- Existing standby and MFA staging remain unchanged; no Neon/Aiven writes, paid resources, DNS routes or Cloudflare deployments were performed.

The guarded final-delta scripts and transaction rehearsal tests from PR #217 are now copied into this active Free hosting branch, unchanged in behavior: `scripts/aiven-verify-content.mjs`, `scripts/aiven-final-delta-sync.mjs`, `scripts/aiven-final-delta-plan.mjs`, `scripts/aiven-final-delta-docker-rehearsal.mjs`, and `tests/aiven-final-sync-safety.test.mjs`. The manual local runner workflow runs these tests with synthetic Postgres only. The **new branch** should rerun these guards locally before considering a cutover; no live sync was executed in this iteration.
