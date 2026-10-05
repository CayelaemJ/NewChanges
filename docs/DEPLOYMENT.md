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
DATABASE_URL=postgresql://...
ADMIN_EMAIL=you@company.com
ADMIN_PASSWORD=choose-a-strong-password
COOKIE_SECURE=true
```

Railway supplies `PORT`.

Additional production configuration includes the public base URL, contact/legal settings and SMTP configuration where those capabilities are enabled.

See [.env.example](../.env.example) for the repository's configuration template.

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
GET /health
GET /version
```

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
