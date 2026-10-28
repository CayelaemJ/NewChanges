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
