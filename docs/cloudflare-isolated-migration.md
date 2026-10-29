# NewChanges → Cloudflare: isolated migration with Render preserved

## Scope (28 October 2026)
The current `newchanges-standby` Render deployment, its environment variables,
PostgreSQL/Neon connection, MySQL reporting replicas, imports, jobs and DNS
**must remain untouched**. The Cloudflare copy is a *separate testing environment*.

Cloudflare Pages project provisioned and a public-only preview deployed:
`newchanges-app` (preview alias `https://migration.newchanges-app.pages.dev/`).
The repository branch `chore/cloudflare-isolated-preview-20261028` builds a separate public-only
Pages advanced-mode Worker build in `cloudflare-output/pages/_worker.js`.
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
`https://migration.newchanges-app.pages.dev/`.
Cloudflare confirmed the workers.dev route was enabled and a version was
receiving 100% of preview traffic. The published source must be generated with `node scripts/cloudflare/build-isolated-preview.mjs` from the reviewed branch. The previously attempted checked-in source snapshot was incomplete and has been removed; do not use it as an artifact.

The NewChanges repository's isolated GitHub Action
`NewChanges Cloudflare isolated preview readiness` failed **before
any job steps executed** due to runner availability/permissions. Do
not misreport that as a passed source build.

For independent runtime evidence, an isolated external verification runner
was used only to fetch the public preview URL (not the private repo):
`the independent verification run recorded on 28 October`.
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

A formerly separate Cloudflare Worker, `newchanges-api-canary`, ran
the initial **edge API runtime**, not the real NewChanges data backend:

- `GET /api/health` reports `environment: cloudflare-isolated-canary`
  and `production: false`; GET/HEAD only.
- `GET /api/migration/capabilities` clearly reports authentication,
  dashboard, jobs, imports and notifications disabled; database disconnected.
- Unknown API paths return 404. All writes return 405. No upstream fetch,
  sessions, forwarded headers, database access or secrets.
- Code and negative tests: `cloudflare/newchanges-isolated-api.worker.mjs`
  and `tests/cloudflare-isolated-api.test.mjs`.

The consolidated Pages preview endpoint is
`https://migration.newchanges-app.pages.dev/api/health`.
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


## Standalone NewChanges application namespace — 29 October 2026

**Project identity:** NewChanges / The Fixer. Never use another company name
or another application's Cloudflare account subdomain in NewChanges public
hostnames, application canonical URLs, tests, manifests or operator guidance.

- Cloudflare Pages project: `newchanges-app`.
- Independent staging alias: `https://migration.newchanges-app.pages.dev/`.
- Production Pages hostname reserved: `https://newchanges-app.pages.dev/`
  (**no full production app has yet been deployed there**).
- Isolated Pages deployment succeeded on 29 October 2026 with the existing
  public-brand assets. Follow-up deployment added staging-only
  `/api/health`, `/api/migration/capabilities` and
  `/api/migration/readiness` routes, all explicitly not production-ready.
- The two older NewChanges public Workers subdomains were disabled on
  29 October; their source deployments are retained internally, with
  no public Worker addresses for NewChanges under a shared account namespace.
- Do not change the account-wide Workers subdomain: unrelated services use it.
- No Cloudflare zone/custom hostname currently belongs to this connected
  account. An independently owned custom domain can later be attached,
  but must not be invented or assumed.
- This connected integration can deploy Pages _worker.js via the Pages
  deployment API; the JWT-based asset-upload endpoint cannot currently be
  authorized. Keep direct deploys controlled and isolate branch previews.
- No production DNS, database, Railway or Render settings changed.

This namespace correction does **not** represent a production cutover.
Full frontend, authentication, APIs, role/tenant security, PostgreSQL,
MySQL and jobs must pass the preexisting gate before the Pages production
branch is published. It is unacceptable to promote a public-only staging
preview to main and call that a complete application.

## Repeatable Pages build and CI configuration

The draft branch now includes a dedicated `wrangler.jsonc` for project
`newchanges-app`, production build output reserved for
`cloudflare-output/pages`. The public-only generator writes its Pages
advanced-mode `_worker.js` to that folder for isolated review. This
is **not** the authenticated NewChanges production build.

CircleCI includes a branch-scoped `cloudflare_full_source_candidate` job
to compile the latest backend and React frontend, run security/brand/route
contracts, and store artifacts for release engineering. It does not run
database migrations or deploy automatically. A green CircleCI result has
not yet been independently retrieved or verified.

## CI runner and brand follow-up

GitHub-hosted workflows in the private repository repeatedly failed before
starting any job steps. The two optional Cloudflare validation workflows
have therefore been changed to **manual-only** to stop noisy, misleading
failures. CircleCI is the branch-scoped verification path for compiling
the actual backend/React app and testing the independent Pages Worker
bundle, route parity and branding. Do not claim CircleCI passed without
retrieving the corresponding job result.

Visible React product copy and the browser title have been updated from
the former internal name to **The Fixer**. Internal CSS class names
were left unchanged to preserve visual compatibility.

The migration PR includes exactly one deployed Pages preview project;
the obsolete synthetic-only Pages probe project was deleted after verifying
its sole deployment was a preview. The old preview Workers' public URLs
are disabled. No app user accounts, sessions or live API data have been
moved.

## Existing-session compatibility and native database-backed stage (29 October)

A Cloudflare-compatible session reader has been implemented as
`cloudflare/session-compat.mjs`, preserving the existing Prisma
`Session` model's SHA-256 token digest, expiration, revocation, disabled-user,
deleted-user, role and user-to-employer link handling. No plaintext passwords,
session tokens, password hashes or employer details are sent in its
`safeSessionResponse` output. Negative tests cover duplicate/malformed
cookies, session expiry, revocation, disabled accounts and cross-tenant
role limitations.

The actual native Cloudflare-compatible request boundary is
`cloudflare/native-auth-router.mjs`, composed with
`cloudflare/native-newchanges-worker.mjs`, which uses Prisma 7's
`@prisma/adapter-pg` with the Cloudflare
`HYPERDRIVE.connectionString`. This is **a migration-only auth check**:
it does not replace the full `/api/auth/me` response or enable login,
MFA, reset flows, dashboard API access, employer queries, ingest or jobs.
The adapter refuses missing/misconfigured DB bindings and destroys
request-scoped connections after use.

The isolated Pages preview has been updated to serve the same auth-denial
boundary at `/api/migration/auth-check` and an explicit `/ready` route.
With no staging Hyperdrive connection configured, `/ready` returns 503,
requests without a session cookie return 401, and cookie-present requests
return 503 without querying live data. **These are intentionally
nonfunctional for real user sessions until an isolated database exists.**

A separate `cloudflare/wrangler-native.jsonc` and CircleCI dry-run bundle
test now checks whether the current Prisma/pg implementation can compile
under the Cloudflare Workers runtime. The CI outcome must be verified;
a configured test is not proof of compatibility.

Cloudflare Hyperdrive currently has **zero** configs on the connected
Cloudflare account. Two existing Neon projects match NewChanges naming:
`newchanges-primary-pg18` and `newchanges-identity-dr`; their
credentials and data were **not** read or copied. Do not attach production
Neon databases to an unverified Pages preview. Use a dedicated empty test
database with synthetic accounts first, then the least-privileged production
connection when identity and audit gates have passed.

Port remaining identity flows in this order: (1) staging DB binding,
(2) test account/session compatibility with fixture users, (3) direct
auth/me payload parity including theme/sections/employers, (4) login,
reset, MFA and CSRF, (5) tenant-scoped dashboard reads and cache
invalidation, (6) ingestion/refresh and background queues. Never permit
the application to act on real financial data merely because liveness
responds 200.

## Independent real React frontend build (29 October 2026)

Using a temporary isolated Node 24.22.1 workspace, the complete
`frontend/` tree from the current migration branch was reconstructed
using the private connected GitHub source and the committed
`frontend/package-lock.json`. No production database or API
credentials were supplied. Commands completed successfully:

```sh
npm ci --prefix frontend --no-audit --no-fund
npm run build --prefix frontend
```

Vite 8.3.5 compiled 365 modules. Generated artifacts:
- `public/react/index.html` 581 bytes
- `public/react/assets/index-COvQLIR_.css` 133825 bytes
- `public/react/assets/index-CF1Fbx8y.js` 425171 bytes

Warnings indicate that the existing standalone HTML expects additional
`/static/brand-engine.js`, `/static/dark-theme-v2.css`, and
`/static/the-fixer-logo*.svg` at runtime. These are real project
assets and must be included in Cloudflare's published static asset tree.
The React UI is not yet deployed as an authenticated Pages application.
No CircleCI status is inferred from the isolated successful build.

The native auth adapter and source-compatibility negative tests have
also been added to CI. No working Hyperdrive configuration exists yet
on the connected Cloudflare account. Release gate remains blocked.

The same isolated Node workspace executed `node --test tests/cloudflare-session-compat.test.mjs tests/cloudflare-native-auth-router.test.mjs`: **12 tests passed, 0 failed**. These are synthetic, local unit tests, not a live database integration or verified tenant-isolation E2E release test.
