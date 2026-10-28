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
