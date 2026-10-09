# Production readiness — remaining gaps

Last reviewed: this pass (automated verification, repository only).

This document records what is **already verified green** and what is **still
outstanding** before the Portal should be described as production-ready. It is
deliberately engineering/operational in scope. Security controls are tracked in
the control register in [../SECURITY_ASSESSMENT.md](../SECURITY_ASSESSMENT.md);
this file does not duplicate that register, it complements it.

## Verified green in this pass

| Check | Result |
|---|---|
| `npm ci` | pass |
| `npm run build` (prisma generate + tsc + Vite frontend build) | pass |
| All 19 CI workflow gates (`.github/workflows/ci.yml`) | pass |
| `npm audit --audit-level=high` | pass (6 low/moderate advisories only: `tedious`/`sprintf-js` via `mssql`) |

The static gates are genuinely green. The remaining risk is **not** in the code
compiling; it is in configuration, operations and unverified runtime behaviour.

## Blocking gaps

These should be closed before a go-live decision.

### 1. The aggregate release gate is red and CI is out of sync

`npm run check:all` includes checks that the CI workflow does not run, and two
of those checks currently **fail**:

- `npm run check:unified-data-ingestion` — fails: it asserts
  `src/server.ts` still contains `/api/admin/integration/config`, but the
  endpoint is now `/api/admin/integration` (GET/POST). Stale assertion.
- `npm run check:enterprise-analytics-phase-2` — fails: it asserts
  `src/services/syncService.ts` contains a `"Never expose replica password"`
  comment that no longer exists. Stale assertion.

Because CI does not run `check:unified-data-ingestion`,
`check:enterprise-analytics-phase-2`, `check:admin-realtime`,
`check:admin-report-selector` or `check:enterprise-operations`, the drift went
unnoticed. `check:admin-realtime`, `check:admin-report-selector` and
`check:enterprise-operations` do pass.

Action: update the two stale assertions (or the code they protect), and make CI
run the same set as `check:all` so the two definitions cannot diverge again.

### 2. The health check does not test dependencies

`GET /health` returns `{ ok: true }` unconditionally
(`src/server.ts`), and `railway.json` uses `/health` as the deploy
healthcheck. An instance with a dead database, failed migration or unpublishable
data still reports healthy. Add a dependency-aware readiness check (database
round-trip, and a separate liveness probe if needed) and point the platform
healthcheck at the readiness route.

### 3. No fail-fast configuration validation

The server starts even when required variables are missing. It only logs a
warning for a missing `CONTACT_EMAIL` and for missing `ADMIN_EMAIL`/
`ADMIN_PASSWORD`; a missing `DATABASE_URL` surfaces later as a runtime error.
Production configuration should be validated at boot and the process should
refuse to start when a required value is absent or malformed. Related: the
`.env.example` template omits `DATABASE_URL`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`
even though `docs/DEPLOYMENT.md` lists them as required.

### 4. Production schema deployment uses `prisma db push`, not migrations

`scripts/deploy-db.mjs` (run as the Railway pre-deploy step) uses
`prisma db push --skip-generate` plus ad-hoc `db execute` calls. The repository
also carries a `prisma/migrations/` history that is only partly applied this
way. `db push` has no migration ledger, no ordered history and no rollback
path. Adopt `prisma migrate deploy` with a reviewed migration history for
production, keeping destructive changes explicitly planned.

### 5. Production values and legal sign-off

Still required and outside code:

- real `PUBLIC_BASE_URL`, `CONTACT_EMAIL`, privacy/legal contacts, Information
  Officer, SMTP credentials and database credentials;
- legal/privacy owner approval of the privacy notice, terms, cookie notice and
  the published "last updated" date;
- confirmation of the business address wording (published address vs registered
  office).


## Should close before scaling / for enterprise assurance

| # | Gap | Notes |
|---|---|---|
| 6 | CSP still allows `script-src 'unsafe-inline'` | Pages use inline scripts/handlers; move to nonces or external JS. |
| 7 | No admin MFA | Tracked as OPEN in the security register. |
| 8 | No centralised security logging / SIEM forwarding | Audit records exist in-app; off-platform immutable retention is outstanding. |
| 9 | Monitoring, alerting and error tracking unverified | `/health`, `/version` and email/Slack paths exist, but no APM/error tracker and no recorded alert test. |
| 10 | Backup/restore and RPO/RTO unverified | No completed restore record; see the release runbook. |
| 11 | No independent penetration test | Proposed scope exists; no dated external report. |
| 12 | Secrets inventory and rotation unproven | No rotation schedule or evidence. |
| 13 | Database least privilege / RLS | Separate runtime, migration and read-only roles not evidenced. |
| 14 | No browser E2E, axe or load-test evidence | Coverage is static string/regression checks; no Playwright/axe/k6-style runs against real data. |
| 15 | Retention/deletion automation not enabled | POPIA retention rules are recorded but no automated deletion job is enabled. |
| 16 | Single-replica assumptions | The rate limiter is in-process; the automation scheduler and admin SSE stream have no cross-replica coordination. Daily refresh and scheduled reports do coordinate (advisory lock / DB claim). Fine for one Railway instance; revisit before horizontal scaling. |

## Minor observations

- CI runs `npm run build` (which includes the frontend build), so the React
  workspace is compiled in CI — good. The React route remains a migration
  workspace by design and is not a blocker for the canonical `/dashboard`.
- `connectionTimeout: 0` disables the incoming connection timeout; the
  `headersTimeout` (180s) bounds slow-header attacks, but a finite connection
  timeout would be more defensive.
- The admin SSE endpoint (`/api/admin/events`) holds long-lived connections with
  no explicit cap.

## Bottom line

The application builds, all CI gates pass, and the static regression suite is
broad. It is **not** yet production-ready in the operational sense: the
aggregate gate is red, the health check is shallow, config is not validated at
boot, schema deployment is not migration-based, and the external/operational
evidence (pen test, monitoring, backup restore, MFA, legal sign-off) is
outstanding. Items 1–5 are the practical blockers; items 6–16 are the
enterprise-assurance backlog.
