# Deployment

## Railway

Railway is the primary production deployment target.

The checked-in `railway.json` and Railpack define the application deployment.

Expected sequence:

```text
Build
  npm run build

Pre-deploy
  npm run db:deploy

Start
  npm start
```

The application start command must remain independent of schema deployment so the healthcheck is not held behind database work.

## Required environment

At minimum:

```env
NODE_ENV=production
DATABASE_URL=postgresql://...
ADMIN_EMAIL=you@company.com
ADMIN_PASSWORD=choose-a-strong-password
COOKIE_SECURE=true
```

Railway supplies `PORT`.

Startup validates configuration and **refuses to start** when a required value
is missing or malformed (for example a missing `DATABASE_URL` in production, an
invalid `PUBLIC_BASE_URL`, or a non-boolean `COOKIE_SECURE`). Optional settings
(for example a missing `CONTACT_EMAIL`) log a warning and degrade gracefully.
See `src/config.ts` for the full list.

Additional production configuration includes the public base URL, contact/legal settings and SMTP configuration where those capabilities are enabled.

See [.env.example](../.env.example) for the repository's configuration template.

## Schema deployment

Production uses **versioned migrations**, not `db push`:

```text
pre-deploy: npm run db:deploy
  → prisma migrate deploy
```

The migration history lives in `prisma/migrations/`. `00000000000000_baseline`
captures the schema as it existed when migrations were introduced; the earlier
timestamped migrations are idempotent and become no-ops once the baseline is
applied.

**Existing database (previously managed with `prisma db push`)**

The deploy script detects a database that already has the application schema
but no `_prisma_migrations` history and automatically marks the baseline as
applied before running `migrate deploy`. To do this manually:

```bash
npm run db:baseline   # prisma migrate resolve --applied 00000000000000_baseline
```

**Escape hatch**

If a migration-based deploy must be backed out, set `DB_DEPLOY_MODE=push` to
restore the previous `prisma db push` behaviour. Do not leave this set long
term — new schema changes should be added as migrations.

Future schema changes must be added as a new migration
(`prisma migrate dev --name ...` against a development database), reviewed, and
committed. Destructive changes must be explicitly planned.

## External SQL source

The external source account must be read-only.

The source should expose the canonical views documented in the root README.

The browser must never receive SQL credentials.

## Container deployment

An alternate Dockerfile is available at:

```text
deploy/Dockerfile
```

Build it with:

```bash
docker build -f deploy/Dockerfile .
```

Run the database deployment step as a release/pre-deploy operation before starting the application.

## Health verification

After deployment verify:

```text
GET /health       # readiness — returns 200 only when the database is reachable
GET /health/live  # liveness — process is up, no dependency check
GET /version
```

`railway.json` uses `/health` as the deploy healthcheck, so an instance with an
unreachable database fails the check instead of reporting healthy.

Then exercise authentication and the main dashboard flow.

For production releases also verify:

- employer isolation;
- reporting-period comparisons;
- live data availability;
- scheduled reporting;
- data-quality warnings;
- admin access;
- mobile/desktop critical flows.

## Rollback

Keep a known-good application deployment available.

Do not use destructive database reset commands in production.

Schema changes should be additive or explicitly planned with a recovery strategy.

For full release/recovery requirements see [PRODUCTION_RELEASE_RUNBOOK.md](PRODUCTION_RELEASE_RUNBOOK.md).
