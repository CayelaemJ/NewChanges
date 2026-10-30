# NewChanges full application → Cloudflare primary (not a React-only migration)

## Scope correction (29 October 2026)

The canonical source of truth is the **entire** `CayelaemJ/NewChanges`
repository, branch `main`. It includes Node 24 + Fastify, Prisma 7,
the existing public/admin/dashboard/login HTML, embedded React components,
MySQL reporting integrations, sync pipelines, business logic, mail and
scheduled work. Migrating only the React frontend would **not migrate the
application**, and the separate public Pages preview is not production.

**Deployment architecture:** Cloudflare Workers + **Cloudflare Containers**
runs the same `dist/server.js` produced by the repository's existing
`npm run build`. The Worker routes requests to that original app,
not to Render, Railway, a second React app or a rewritten partial API.
Cloudflare Containers requires Workers Paid and an image build
environment; their account availability/billing is not yet confirmed.
The Dockerfile is rooted at the repository so every asset, import,
route and Prisma schema is built alongside the original server.
Render stays standby; there is no Railway dependency at runtime.

## Files

- `Dockerfile.cloudflare`: Node 24 multi-stage build of the current
  NewChanges backend and all its production static assets.
- `cloudflare/main-app/worker.mjs`: Cloudflare routing entrypoint and
  Container Durable Object. It routes the complete app only when a
  canonical NewChanges hostname, secret and backend release switch match.
- `cloudflare/main-app/preflight.mjs`: fail-closed native PostgreSQL
  preflight *before* the Fastify process starts. No schema writes.
- `cloudflare/main-app/verify-database.mjs`: validates effective Neon
  role privileges; refuses admin roles, accidental superuser membership,
  bad database targets and stage write grants.
- `wrangler.newchanges-main.jsonc`: private Worker name,
  `workers_dev: false`, all switches off, isolated Container.
- `cloudflare/main-app/package-lock.json`: locked Wrangler and Container
  dependencies.
- `tests/cloudflare-main-app-container.test.mjs`: negative release tests.

## Main database

- Neon project `newchanges-primary-pg18`, database `newchanges`,
  `main` branch remains the live authoritative database.
- Do **not** attach `newchanges-identity-dr` as primary or create new
  PostgreSQL databases.
- The previously provisioned
  `newchanges_cf_migration_reader` was found to inherit privileged
  Neon administration permissions. **Never reuse this role.** Its
  removal is tracked in issue #216.
- Until a verifiably least-privileged *existing schema-compatible*
  credential can be provided through a Cloudflare secret, the Worker
  backend remains disabled. Do not commit database URL, keys,
  passwords or certificates.
- Existing app tenant isolation needs real E2E verification; audited
  production tables do not currently have DB RLS enabled. Do not
  turn on RLS directly without testing a branch.
- MySQL reporting connectivity, SMTP, source vault, upload paths,
  webhook verification, sync leader election, source policies and
  AI integrations still require independent parity checks.
- Containers have ephemeral local disks. Files that must survive
  instance restarts need durable object/R2/DB storage.

## Release sequence

1. Run `node --test tests/cloudflare-main-app-container.test.mjs`,
   `npm ci && npm run build` from the actual repo. Run the CircleCI
   `cloudflare_main_backend_container_candidate` job.
2. Obtain an appropriate Cloudflare Workers Paid account and
   Docker-capable image build; run `docker build --platform linux/amd64
   -f Dockerfile.cloudflare .` against checked-out source.
3. Provision a new role through Neon with **checked effective grants**.
   Never use the known overprivileged role. Store the direct Neon PG18
   connection string under Cloudflare's protected
   `NEWCHANGES_NEON_DATABASE_URL` Worker secret. Configure a
   NewChanges-only owned hostname.
4. Deploy with all release flags false; enabling backends is a separate
   change after auditing connection, user sessions, CSRF, tenant
   boundaries, uploads and admin MFA. Staging startup uses
   `STANDBY_MODE=true`, disabling bootstrapping and scheduled writes
   while the candidate is tested. This is not the intended final mode.
5. Validate the actual Fastify backend, including original
   `/health`, `/ready`, `/login`, `/admin`, dashboard, login
   and session calls. Confirm database read and denied cross-tenant
   access; test Node-dependent and MySQL operations.
6. Configure the sole authoritative scheduler and sync leader with
   idempotency, backoff and monitoring; only then enable write
   leadership after an approved cutover. Prevent Render standby from
   running independent schedulers.
7. Test rollback and compare a full application route and data parity
   matrix; route production traffic to Cloudflare only after green E2E
   and the owner's cutover approval.

**Work not performed:** no Containers image published, no Cloudflare
prod DNS, no Hyperdrive binding, no Neon database migration, no Render
shutdown, no operational write leader enabled. All release flags are
false by default. An edge dry-run is not an image build or a full live
app test.
