# NewChanges → Cloudflare: isolated migration with Render preserved

## Scope (28 October 2026)
The current `newchanges-standby` Render deployment, its environment variables,
PostgreSQL/Neon connection, MySQL reporting replicas, imports, jobs and DNS
**must remain untouched**. The Cloudflare copy is a *separate testing environment*.

Cloudflare Pages Direct Upload project provisioned:
`newchanges-isolated-static` (no Pages deployment uploaded).
The repository branch `chore/cloudflare-isolated-preview-20261028` builds a separate public-only
Workers preview in `cloudflare-output/newchanges-isolated-preview.worker.mjs`.
It requires no GitHub App integration and no Cloudflare token to build in CI.

## First preview is intentionally restricted
- Uses the actual public `public/home.html`, legal pages and branding assets.
- No admin HTML, authenticated dashboard, React private shell, session code,
  login, contact, password reset or customer data is included.
- `/api/*` returns 404; account/login/dashboard/React/contact routes return 403.
- Read-only methods; no database, SMTP, OpenAI, MySQL, Prisma, jobs, imports or
  migrations are contacted.
- `X-Robots-Tag: noindex` and noindex meta tags prevent duplicate indexing.
- Contact and authentication must be carried out on the original Render app
  until the Cloudflare application is properly reimplemented and tested.
- Smoke tests use only synthetic paths and deliberately reject credentials.

**This public preview is not yet NewChanges the functioning product.** It
demonstrates origin-independent static hosting, branding and a privacy-safe
testable route. Do not deploy the authenticated portal as a static site.

## Main application migration dependency map
1. **Frontend:** Vite React app under `frontend/` currently builds with
   `base: '/react/'` into `public/react`. Stage its output separately,
   review browser credential/session behavior, CSS/brand assets, and private
   route handling. Never expose it until auth is ready.
2. **Identity & tenancy:** Fastify cookies, Prisma roles, row-level ownership,
   trusted proxies, origin checks, MFA, CSRF and audit events need a dedicated
   Cloudflare-native session/login design. No session passthrough to Render
   by spoofing trusted headers.
3. **SQL connectivity:** Preserve Neon/Postgres and read-only MySQL reporting
   replica initially. Review Cloudflare Hyperdrive or secure API adapters.
   No direct production database credential reuse in Cloudflare test.
4. **Sync jobs:** `node-cron`, source-ingestion, scheduled refresh, server
   processes, PDFs, file uploads and notification queues must be divided into
   Workers-compatible tasks vs. durable scheduled/queue workers, with idempotency.
5. **Secrets & delivery:** Store credentials only in platform secrets.
   Test safe email, webhook verification, rate limits, external API permissions,
   short timeouts, retries, health checks and alerts using synthetic fixtures.
6. **Verification:** Separate database fixture and staging tenancy; synthetic
   account flows, access-denial/IDOR, CSRF, backups/restores, import continuity,
   audit logging, negative abuse cases and real browser E2E on Cloudflare.
7. **Cutover:** only after an approved release and rollback strategy. No
   automatic DNS switch or Render decommission.

Use the existing repo security rules in AGENTS.md. Do not paste passwords
or connection strings in issues, CI logs or the build.

## Expected outcome for this phase
- Static marketing on Cloudflare without Render asset fetches.
- **Render continues to run exactly as before**.
- Authenticated product migration remains open and explicitly unverified.

## Staging deployment and external verification — 28 October 2026

The Cloudflare API deployed the **public-only staging Worker** as
`newchanges-cloudflare-preview`. Its isolated preview address is
`https://newchanges-cloudflare-preview.cabo-solutions-za.workers.dev/`.
Cloudflare confirmed the workers.dev route was enabled and a version was
receiving 100% of preview traffic. The published source must be generated with `node scripts/cloudflare/build-isolated-preview.mjs` from the reviewed branch. The previously attempted checked-in source snapshot was incomplete and has been removed; do not use it as an artifact.

The NewChanges repository's isolated GitHub Action
`NewChanges Cloudflare isolated preview readiness` failed **before
any job steps executed** due to runner availability/permissions. Do
not misreport that as a passed source build.

For independent runtime evidence, CABO Solutions' working GitHub runner
was used only to fetch the public preview URL (not the private repo):
`https://github.com/CayelaemJ/CABOSOLUTIONS/actions/runs/40712023624`.
That workflow passed real HTTPS brand/HTML and security-header checks,
blocked live login/dashboard/React/API routes, and desktop/mobile
Chromium page checks. It submitted no customer information or real logins.

This proves the **public marketing preview** runs on Cloudflare without
requesting Render's frontend assets. It does *not* demonstrate production
Fastify/Prisma/Neon/MySQL/auth/ingestion compatibility. The currently
running Render service remains untouched, with no DNS changes.

### Production readiness gates still open
- Fully isolated Cloudflare staging authentication and tenant data.
- Read-only copy/fixtures for Postgres and MySQL integration; no production
  credentials initially.
- Port/test Node-only jobs, Prisma adapters, ingestion, mail, webhooks.
- Pass all repository security, billing, runtime and browser regression
  checks on a functional, authenticated Cloudflare environment.
- Data protection, backup/restore and rollback verified before cutover.

## Independent staging builds (28 October 2026, later iteration)

The repository's GitHub Actions runner could not execute a job. A dedicated
`cloudflare_newchanges_staging_build` CircleCI job is now configured for
**only** `chore/cloudflare-isolated-preview-20261028`. It performs two
separate build operations with no database service or application secrets:

1. Generate the restricted marketing Worker from the checked-in public
   assets and execute its no-network, negative access tests.
2. Compile the existing React frontend into `public/react`, saving the
   output as an internal CircleCI artifact with the explicit label
   `private-react-build-NOT-PUBLISHED`. This artifact is **not** a
   production-capable app; its auth and data APIs still require the
   Fastify/Prisma/backend migration.

The public preview generator now excludes binary PNG/ICO assets from
text-only Workers bundling; the isolated Worker serves the branded SVG icon
as an explicit fallback. This avoids pushing binary data through an
assumed UTF-8 content path. No Build → Deploy automation has been enabled.

### Evidence and pending checks
- The external public preview smoke passed previously.
- A new external browser/HTTP test covers icon and web-manifest routes.
- The new CircleCI job is configured, but a successful CircleCI run
  has **not yet been independently confirmed**.
- Worker public assets and private React build must not be confused.
- Preserve Render `newchanges-standby` and its DNS/database exactly
  until independent functional API migration passes.

## Reproducibility safeguard
The isolated Worker is generated from real tracked public assets in CI.
Do **not** commit a truncated or manually copied Worker build artifact.
The checked-in generation script is the deployable source of truth.
Public preview deployment is verified by the external Chromium smoke workflow,
but the NewChanges repository's own compilation job has not executed due to
GitHub runner failure. Until a dedicated isolated build completes, do not
promote the draft PR or infer that a newly generated Worker matches the live one.

## Isolated API canary — no data access

A second independent Cloudflare Worker, `newchanges-api-canary`, runs
the initial **edge API runtime**, not the real NewChanges data backend:

- `GET /api/health` reports `environment: cloudflare-isolated-canary`
  and `production: false`; GET/HEAD only.
- `GET /api/migration/capabilities` clearly reports authentication,
  dashboard, jobs, imports and notifications disabled; database disconnected.
- Unknown API paths return 404. All writes return 405. No upstream fetch,
  sessions, forwarded headers, database access or secrets.
- Code and negative tests: `cloudflare/newchanges-isolated-api.worker.mjs`
  and `tests/cloudflare-isolated-api.test.mjs`.

Its public endpoint is
`https://newchanges-api-canary.cabo-solutions-za.workers.dev/api/health`.
This isolates deployment/runtime/HTTP checks from the security-sensitive
Fastify/Prisma adapter work. **Do not interpret a green canary as proof that
the full app was migrated.**

## Railway source-of-truth inventory — 29 October 2026

The user has designated Cloudflare as the desired **future primary NewChanges application**. Existing Render standby remains unchanged until verified production cutover.

Connected Railway project `merry-cooperation`:
- Production environment: `07f92af8-ac8b-4e1c-baa5-a865b19c6ab2`.
- Application: `NewChanges`, service `b6e3c7a7-65b9-4c2a-ba7a-1db7a8592709`, repo `CayelaemJ/NewChanges`, branch `main`, port 8080.
- Railway domains: `newchanges-production.up.railway.app` and `newchanges-production-597f.up.railway.app`.
- Deployment config: `npm start`, `npm run db:deploy` as pre-deploy command, `/ready` health path. **Cloudflare must not copy this pre-deploy migration command or automatically run DB schema writes.**
- Latest service deployment in Railway environment inventory shows FAILED (2026-10-13); listing deployment history filtered `SUCCESS` returned none at inspection. Do not assume Railway is a healthy fallback without a separate active response test.
- Config variable *names* indicate Postgres `DATABASE_URL`, MySQL host/user/pass/port, SMTP replacement via `RESEND_API_KEY`, superadmin credentials, and semantic/sync background settings. Values were deliberately not read or copied.
- Railway Testing environment includes `NewChanges-Testing-Rehearsal` and a persistent MySQL volume. Do not connect Cloudflare staging to that database without scoped, approved read-only credentials.
- Render `newchanges-standby` is still unsuspended. Its DB, branch, hostname, secrets, routes and service remain untouched.

### Cloudflare production architecture to implement
1. Cloudflare Worker plus first-party static assets and HTTP routing. Existing public-only preview is not a substitute for the authenticated frontend.
2. Isolate Fastify routes into Fetch-compatible domain handlers. Add a database access adapter for Prisma 7 driver/Workers/Hyperdrive, with explicit environment bindings and dedicated least-privileged SQL credentials; confirm MySQL replication read-only grants.
3. Implement server-side session storage, password reset, MFA, tenancy permissions and CSRF protection before enabling any user-facing API.
4. Move scheduled refresh/imports/report delivery to explicitly enabled scheduled/queue workloads with idempotency fences and bounded retries. Do not start cron timers on every Worker invocation.
5. Add audit/telemetry/alerting without leaking people/financial data to logs.
6. Deploy one isolated authenticated fixture tenancy, verify E2E with real browser and negative access tests, and rehearse rollback. Publish primary hostname only after this gate.

A checkable, source-controlled release gate is implemented in
`cloudflare/primary-readiness.mjs`, with negative tests in
`tests/cloudflare-primary-readiness.test.mjs`. It explicitly refuses
production readiness without authenticated E2E, tenant isolation, scoped
production secrets, job idempotency, supported capability verification and
rollback. **This release gate is code, not evidence that its conditions are
already met.** The Cloudflare primary is **not yet production-ready**.

### Platform feasibility
Cloudflare documentation (Oct 2026) confirms Workers supports a subset of
Node.js APIs, and Hyperdrive supports connecting PostgreSQL/MySQL on the Free
plan with usage limits. These facts do NOT guarantee that Fastify + Prisma 7,
native libraries, importing, email, and cron behave unchanged. Each subsystem
requires actual deployment/testing before cutover.

## Primary Cloudflare target and production feature parity (29 October 2026)

**The product's desired canonical application is Cloudflare**, not the public-only
preview, not a Cloudflare-hosted standby, and not a white-label marketing demo.
Railway is the existing deployment source; Render must remain a temporary
recovery target only, not the permanent backend architecture.

Latest upstream code baseline verified on GitHub:
`main@93cb643e69e2cc0f2676fe3933c8a9eaa0759f79` (28 Oct 2026).
The Cloudflare migration PR was branched from precisely that baseline; the
subsequent branch-only Cloudflare files **do not replace any recent main code**.

The migration must preserve the production upgrades already included in main,
especially:
- Patched CI scanners and protected scanner finding summaries (PR #201/#209).
- Disposable-Postgres cross-tenant RLS negative tests and documented limitations
  of synthetic RLS versus production policy rollout (PR #206).
- Node 24 production/security upgrades (PR #205).
- Existing Fastify routes, Prisma database models, source ingestion/sync,
  semantic publication, React UI, financial analytics, role permissions,
  reports, mail, AI/MLOps, security logs, brand-engine styles and CI suite.

**Do not silently strip authentication, live data, features or custom branding
to claim Cloudflare production parity.** The current read-only Worker and API
canary are technical stepping stones, not the desired production deployment.

Before a Cloudflare primary cutover, generate an evidence-backed feature
parity inventory by comparing current `main` API paths, browser routes and
scheduled work. Then deploy/test the complete application, establish
Cloudflare-native isolated secrets/database/session integration, and pass the
security gates in `cloudflare/primary-readiness.mjs`. Keep production DNS
unchanged until release criteria pass, and preserve Render for rollback.
