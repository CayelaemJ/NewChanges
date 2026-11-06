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


## 2026-11-06 production target read-only preflight and evidence gating

Aiven connector reported `the-fixer-postgres` **RUNNING**, PG18.6 Free, `defaultdb`, 57 public tables, 198 MB, `newchanges_app_runtime` LOGIN role exists, and 14 active connections out of max 20. This is a snapshot, not connection-pool headroom under production load. No SQL writes were made.

The operator's isolated PostgreSQL 18 final-delta replay/rollback test passed. A new offline file `scripts/production-cutover-evidence-check.mjs` and its three regression tests check a **local operator-maintained JSON evidence manifest** with exact source/target identities, independent source and target backup checksums, independently tested restores, source and background writer fences, delta and final reconciliation, MFA verification, sole-writer state, rollback review, and ordering timestamps. **This script validates only evidence declarations and structure; it does not technically prove any of them, initiate any database operations, or authorize routing.** A successful fake manifest must never be interpreted as go-live approval. Tests run on the self-hosted manual CI.

The minimal manifest schema, excluding all secrets:
```json
{
  "environment": "production",
  "source": "Neon:newchanges",
  "target": "Aiven:the-fixer-postgres/defaultdb",
  "oldWriterStoppedAt": "YYYY-MM-DDTHH:mm:ssZ",
  "finalDeltaFinishedAt": "YYYY-MM-DDTHH:mm:ssZ",
  "sourceBackup": {"verified": true, "evidence": "internal backup/restore reference", "checkedAt": "YYYY-MM-DDTHH:mm:ssZ", "restoreTested": true, "offsiteCopy": true, "sha256": "64-char actual hex checksum"},
  "targetBackup": {"verified": true, "evidence": "internal backup/restore reference", "checkedAt": "YYYY-MM-DDTHH:mm:ssZ", "restoreTested": true, "offsiteCopy": true, "sha256": "64-char actual hex checksum"},
  "sourceWritersFenced": {"verified": true, "evidence": "writer and scheduler disable audit", "checkedAt": "YYYY-MM-DDTHH:mm:ssZ"},
  "backgroundJobsFenced": {"verified": true, "evidence": "worker shutdown audit", "checkedAt": "YYYY-MM-DDTHH:mm:ssZ"},
  "finalDeltaComplete": {"verified": true, "evidence": "final sync log and transaction receipt", "checkedAt": "YYYY-MM-DDTHH:mm:ssZ"},
  "contentReconciliation": {"verified": true, "evidence": "57-table comparison, audit and sessions", "checkedAt": "YYYY-MM-DDTHH:mm:ssZ"},
  "authenticationAndMfaVerified": {"verified": true, "evidence": "authenticated functional checks", "checkedAt": "YYYY-MM-DDTHH:mm:ssZ"},
  "singleWriterVerified": {"verified": true, "evidence": "writer leader and database connection audit", "checkedAt": "YYYY-MM-DDTHH:mm:ssZ"},
  "rollbackReviewed": {"verified": true, "evidence": "verified recovery procedure", "checkedAt": "YYYY-MM-DDTHH:mm:ssZ"}
}
```

Keep actual production evidence manifest on the operator's local encrypted storage, **not GitHub**, and never populate booleans true based only on intention. The first real backup and restoration checks still need to be performed. The application must remain disconnected from Aiven while the existing Neon writer is active.


## Encrypted backup and actual offline restore drill (2026-11-06)

The scripts below were added to the **active free-hosting branch**. They have not yet been executed against live Neon or Aiven. Do not mark a recovery point verified until there are successful dump, checksum, **actual offline restoration**, and independent protected copy results. This section is a procedure, not evidence of a completed backup.

- `scripts/production-encrypted-backup.mjs`: read-only `pg_dump` using private `DR_SOURCE_DATABASE_URL` or `DR_TARGET_DATABASE_URL` from process environment (never in CLI args). Pinned Neon source (`newchanges`) and Aiven destination (`defaultdb`). Emits a custom-format PostgreSQL archive directly into `age` public-key encryption; **does not store the unencrypted dump**. Enforces TLS, outputs encrypted archive SHA-256. Restricted local destination directory, no connection to Render/Cloudflare, no schema changes.
- `scripts/verify-encrypted-backup-restore.sh`: decrypts a selected backup into a disposable networkless `postgres:18-alpine` container and runs `pg_restore --exit-on-error`, verifying the 57 public tables plus Session/Audit table queries. Deletes the container on exit, does not touch production. **A successful dry-restore is required, but it does not guarantee application-level fidelity or prove an offsite copy exists.**
- `tests/production-encrypted-backup.test.mjs`: offline tests for URL pinning, fail-closed behavior and encrypted streaming/restore isolation. Added to manual self-hosted CI; no live credentials in CI.

### Operator's WSL Ubuntu backup procedure

Prepare `age`, PostgreSQL **18** client tools, Docker and an independent backup location on encrypted storage. Install tooling with the OS package manager as needed. Never paste secret connection URLs, private age identity, passwords, or database contents into chat, terminal command arguments, GitHub Actions or repository files. Use the existing private `DR_SOURCE_DATABASE_URL` and `DR_TARGET_DATABASE_URL` environment variables, provided in the operator's secure shell session. Avoid `set -x` and `env` dumps.

```bash
cd ~/NewChanges-free-edge
git fetch origin
git merge --ff-only origin/feat/free-cloudflare-render-primary-20261105
node --test tests/production-encrypted-backup.test.mjs
bash -n scripts/verify-encrypted-backup-restore.sh
umask 077
mkdir -p "$HOME/fixer-recovery-keys" "$HOME/fixer-recovery-archives"
chmod 700 "$HOME/fixer-recovery-keys" "$HOME/fixer-recovery-archives"
# Generate a new age identity locally ONLY if the operator has no existing recipient/key.
# The identity file is SECRET; keep a separately protected recovery copy.
age-keygen -o "$HOME/fixer-recovery-keys/age-identity.txt"
export AGE_RECIPIENT="$(age-keygen -y "$HOME/fixer-recovery-keys/age-identity.txt")"
export AGE_IDENTITY_FILE="$HOME/fixer-recovery-keys/age-identity.txt"
export NEWCHANGES_BACKUP_DIR="$HOME/fixer-recovery-archives"
node scripts/production-encrypted-backup.mjs source --preflight
node scripts/production-encrypted-backup.mjs target --preflight
# Both of the following are read-only on the DB but write encrypted local backup files:
node scripts/production-encrypted-backup.mjs source --backup
node scripts/production-encrypted-backup.mjs target --backup
```

**Important:** Preserve the encrypted `.pgdump.age` file paths and SHA-256 values from the output. For each file, run:

```bash
AGE_IDENTITY_FILE="$HOME/fixer-recovery-keys/age-identity.txt" \
  bash scripts/verify-encrypted-backup-restore.sh \
  "$HOME/fixer-recovery-archives/<ACTUAL_ARCHIVE_FILENAME>.pgdump.age"
```

Use the actual filenames printed by the backup script. Save a **separate encrypted copy** and record its matching hash. Do not invent backup evidence or mark `offsiteCopy`, `restoreTested`, `sha256` or `verified` in the cutover manifest before checks finish. Local storage alone is not an independent recovery location. The local backup tool intentionally does not upload archives to cloud services.

**Security/compatibility limits:** `pg_dump` needs PostgreSQL 18 client compatibility and sufficient SELECT access to all backed-up objects. Neon-managed nonportable schemas or restricted permissions may make an attempted full restore fail; do not silently exclude them to turn a failed drill green. Aiven Free does not provide a substitute for these independent recovery copies. This procedure is read-only on production but may impose temporary load and increase transfer/egress consumption. Its generated archives contain sensitive production data, encrypted only as long as the private age identity remains protected.


## Single-command read-only backup + offline restoration drill (2026-11-06)

New `scripts/production-recovery-drill.sh` automates, in order: private environment/age key checks; both pinned DB URL preflights; streaming encrypted source (Neon) and target (Aiven) backups; SHA-256 output; and two actual independent offline PostgreSQL 18 restores. It refuses a missing private age key or non-matching public recipient. It rejects a backup directory inside the repository. It does NOT stop live writers or apply final migration SQL.

**Before running:** secure the private environment variables `DR_SOURCE_DATABASE_URL`, `DR_TARGET_DATABASE_URL`, `AGE_IDENTITY_FILE`, `AGE_RECIPIENT`, and an absolute `NEWCHANGES_BACKUP_DIR`. Use the protected paths in the instructions above. Keep the private age identity outside the backup archive folder; store independent recovery copies in separate protected storage. Never paste DB URLs, passwords, or private keys in chat, GitHub or terminal commands.

```bash
cd ~/NewChanges-free-edge
git fetch origin
git merge --ff-only origin/feat/free-cloudflare-render-primary-20261105
node --test tests/production-encrypted-backup.test.mjs
bash -n scripts/production-recovery-drill.sh
# WITH THE REQUIRED PRIVATE ENV VARIABLES ALREADY SET IN YOUR SHELL:
bash scripts/production-recovery-drill.sh
```

A successful local backup and offline restore does **not** prove an independent offsite copy, freeze Neon, or approve a cutover. The source remains live, the target may remain stale, and final reconciliation and the sole-writer gate remain outstanding. Since the source may still change during these backups, **take/verify an additional frozen checkpoint backup immediately before final synchronization** as required by the runbook.

This tool has been committed and unit-level checks added to manual CI, but **no real source/target backup or restore has yet been executed by the assistant**.


## 2026-11-06 Recovery safety hardening

The backup command now enforces PostgreSQL `sslmode=require`, `verify-ca` or `verify-full`, refusing `prefer`, `allow` and `disable` before any backup subprocess can run. It also resolves symlinks for the backup directory and the Git checkout and rejects destinations inside the repository **even when the backup utility is executed directly**, not only through the convenience shell script. Both guards have new offline regression tests.

These code changes **do not** attest a live database backup or restore. No Neon/Aiven writes, DNS changes, traffic changes or credentials were configured. Operator must run the offline tests and the actual recovery drill with private credentials before the cutover gate can be satisfied. The automation environment lacks a local Docker daemon and PostgreSQL/age binaries, so an actual isolated archive restore was not executable here.


## 2026-11-06 Cloudflare + Render share the Aiven-backed application

**Chosen deployment topology:** Cloudflare Workers Free is the public HTTPS edge proxy, Render Free runs the original Fastify/Prisma application and holds **the only** PostgreSQL connection pool, and Aiven PostgreSQL 18 `the-fixer-postgres/defaultdb` is the intended single primary application database. Cloudflare's Worker does **not** hold a second `DATABASE_URL`, connect via Hyperdrive, replicate records or become another writer. Browser requests sent to Cloudflare reach the Aiven-backed application through Render after approved cutover.

The disabled Worker config `wrangler.newchanges-free.jsonc` now pins `NEWCHANGES_RENDER_ORIGIN=https://newchanges-free-production.onrender.com`, matching the deployed Render service; `NEWCHANGES_FREE_EDGE_ENABLED=false` and `workers_dev=false` are unchanged. No public Worker route, DNS change, production database connection or secret insertion occurred. Confirm the final canonical hostname before configuring Cloudflare routing.

Added offline `scripts/verify-render-aiven-config.mjs` and tests. The checker validates the *private* Render `DATABASE_URL` without connecting: approved Aiven hostname/port/database; `newchanges_app_runtime` least-privilege username; explicit secure `sslmode`; `connection_limit=2` to bound the existing PrismaPg connection pool; Cloudflare origin guard; secure cookies/trusted reverse proxy; schedulers disabled; and explicit standby state. It does **not** authenticate the actual credentials, check backups, stop old writers, change hosting resources or authorize cutover.

**At authorized cutover only**, install via Render's protected environment UI:
- `DATABASE_URL`: restricted Aiven runtime URL with `?sslmode=require&connection_limit=2` (or `&connection_limit=2` if `sslmode` is already specified). Prefer `verify-full` with the trusted CA when operationally supported. **No URLs or passwords in Git**.
- `NEWCHANGES_EDGE_ORIGIN_SHARED_SECRET`: a new random private value of at least 32 characters; store the *same value* only as an encrypted Cloudflare Worker secret, not in Wrangler `vars`.
- `PUBLIC_BASE_URL`: the chosen canonical HTTPS production URL.
- `STANDBY_MODE`: keep `true` until source writes are fenced and final delta is verified; set `false` only once the sole-writer transition is genuinely approved. Keep `ENABLE_AUTHORITATIVE_INCREMENTAL_SCHEDULER=false` on sleeping Render Free.
- `NEWCHANGES_EDGE_ORIGIN_GUARD_ENABLED=true`, `TRUST_PROXY=true`, `COOKIE_SECURE=true`.

After prerequisites are verified, populate Cloudflare Worker `NEWCHANGES_CANONICAL_HOST` with the approved hostname (no protocol), enable `NEWCHANGES_FREE_EDGE_ENABLED=true` during the routing cutover, install the encrypted origin token, and attach only the reviewed route. Do **not** configure a second direct Aiven database connection in Cloudflare. Direct requests to Render except `/health` must still be rejected without the edge token.

To check branch code without production credentials:
```bash
node --test tests/cloudflare-free-render-edge.test.mjs tests/free-production-cutover-contract.test.mjs tests/verify-render-aiven-config.test.mjs
```

To preflight *locally* with private Render variables that have already been securely obtained, without connecting or printing secrets:
```bash
node scripts/verify-render-aiven-config.mjs
```

**Current state:** Render container deploy previously reported Live but standby/fenced; Aiven service previously reported RUNNING with 57 tables and 14/20 connections at inspection; actual production Render database URL and matching Cloudflare origin token are **not** installed; live Neon is unchanged. Skip persistent staging but **never** skip backup/restore, final-sync reconciliation, MFA checks or sole-writer transition.
