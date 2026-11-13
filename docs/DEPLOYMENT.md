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

## Multi-factor authentication

When `MFA_ENFORCE=true`, all account roles must complete MFA before using protected application pages or APIs. Configure the relying-party origin and TOTP encryption settings on the target hosting service before rollout. Keep the TOTP encryption key persistent across deploys and protect it as a secret.

The account chooses a passkey or authenticator app at first enrollment. Once an active passkey exists, that account is passkey-only; TOTP setup and verification are rejected by the server. Remembered sessions last up to 30 days but expire after seven days idle. Superadmins must save the one-time recovery key before dashboard access.

Follow the [MFA operations and support runbook](MFA_CUTOVER_KEY_AND_ORIGIN_RUNBOOK.md) for required variables, migrations, recovery, smoke checks and the boundary between Render standby and production.

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
