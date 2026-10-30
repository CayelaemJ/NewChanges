# NewChanges — original full application Cloudflare primary

**Source of truth:** https://github.com/CayelaemJ/NewChanges (the existing Fastify 5 + Prisma + actual HTML/React product). This is not the separate EFS React migration project and it is not a static Pages replacement.

## Full-stack migration
- `Dockerfile.cloudflare`: builds existing `src/server.ts` to `dist/server.js` and the actual frontend with `npm run build`, then runs original server with Node 24 and no deployment-time migrations.
- `cloudflare/full-app/worker.mjs`: Worker/Container ingress for original Node backend. It is intentionally turned off until release criteria are independently proven.
- `wrangler.newchanges-full-app.jsonc`: dedicated NewChanges Worker, no shared third-party hostname, no public Workers subdomain, disabled release flags.
- `tests/cloudflare-full-app.test.mjs`: negative tests for hostnames, accidental activation, database identity and incomplete signoffs.
- CircleCI full-source candidate attempts Wrangler dry-run for real Container entry point. This is NOT a Docker image deployment and is NOT evidence of full app parity.

## Cloudflare as primary, Neon as database, Render as standby
- Live Neon **primary project**: `newchanges-primary-pg18`, database `newchanges`.
- Existing Render remains standby; do not automatically proxy it and pretend backend moved.
- No production DNS, secrets, database writes, or traffic cutover until signed off.
- Cloudflare Containers currently requires Workers Paid, actual Docker image build, runtime secret bindings, auth/CSRF/MFA session checks, real tenant-isolation tests, job scheduler parity, and rollback rehearsal.
- All `src/server.ts` production routes, file uploads, MySQL replicas, scheduled refresh, reporting, notifications and admin controls must be preserved. A compile-only success cannot promote production.
- Distinct role problem: the temporary Neon role `newchanges_cf_migration_reader` is overprivileged; its removal remains tracked in issue #216. Never use it for Hyperdrive or any Container secrets.
- Scheduled jobs on a request-driven Container cannot start unconditionally or duplicate Render jobs. The candidate sets initial inactive flags, and must be redesigned to re-enable all operations safely after cutover.

**Release status:** full NewChanges Container candidate committed but not deployed, database not connected, production app not migrated. The Pages preview only serves public/static assets.
