# Production readiness — status and remaining gaps

Last updated: after the remediation pass on this branch.

This document tracks what is verified, what was fixed in the remediation pass,
and what remains outstanding before the Portal should be described as
production-ready. Security controls are tracked in the register in
[../SECURITY_ASSESSMENT.md](../SECURITY_ASSESSMENT.md); operational procedures
are in [OPERATIONS_HARDENING.md](OPERATIONS_HARDENING.md); the two remaining
code-heavy controls are specified in [MFA_AND_CSP_PLAN.md](MFA_AND_CSP_PLAN.md).

## Verified green

| Check | Result |
|---|---|
| `npm ci` | pass |
| `npm run build` (prisma generate + tsc + Vite frontend build) | pass |
| `npm run check:all` (the single aggregate gate CI now runs) | pass |
| `npm audit --audit-level=high` | pass (6 low/moderate: `tedious`/`sprintf-js` via `mssql`) |

## Fixed in the remediation pass

1. **Release gate integrity.** Two checks (`check:unified-data-ingestion`,
   `check:enterprise-analytics-phase-2`) were failing on stale assertions. Both
   are corrected. CI now runs the same aggregate gate as `npm run check:all` so
   the two definitions cannot drift apart again.
2. **Dependency-aware health check.** `/health` now verifies the database and
   returns `503` when it is unreachable; `/health/live` is the dependency-free
   liveness probe. The platform healthcheck uses `/health`.
3. **Fail-fast configuration validation.** `src/config.ts` validates required
   settings at boot and refuses to start on error-level problems. `.env.example`
   now lists `DATABASE_URL`, `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
4. **Versioned migrations.** Production now deploys with `prisma migrate deploy`
   against a committed baseline (`00000000000000_baseline`), with automatic
   baselining for databases previously managed with `db push` and a
   `DB_DEPLOY_MODE=push` escape hatch.
5. **Cross-replica coordination.** The automation scheduler (account cleanup,
   weekly digest) now uses a PostgreSQL advisory leader lock; the admin SSE
   stream is capped (`MAX_ADMIN_STREAMS`). Daily refresh, source sync and
   scheduled reports already coordinated.
6. **Observability hooks.** `LOG_LEVEL` is honoured and an optional
   `ERROR_WEBHOOK_URL` receives redacted error events (5xx, unhandled rejection,
   uncaught exception).

## Remaining gaps

### Requires external execution (cannot be closed by code)

| # | Gap | Required evidence |
|---|---|---|
| 1 | Independent penetration test | Dated report, scoped to the production perimeter, with remediation and retest |
| 2 | Backup/restore + RPO/RTO | Completed restore record per [OPERATIONS_HARDENING.md](OPERATIONS_HARDENING.md) |
| 3 | Secrets inventory and rotation | Populated inventory plus a demonstrated rotation |
| 4 | Database least privilege / RLS | Runtime and migration roles separated and evidenced |
| 5 | Production values and legal sign-off | Real `PUBLIC_BASE_URL`/contacts/SMTP/DB values; legal-owner approval of notices |
| 6 | Centralised log retention / SIEM | Redacted forwarding to an access-controlled store with defined retention |
| 7 | Monitoring and alert testing | Documented coverage plus a recorded alert delivery/acknowledgement |
| 8 | Browser E2E, accessibility (axe) and load-test evidence | Recorded runs against representative business data |
| 9 | Independent reporting validation | Reviewer sign-off reconciling periods/cohorts/totals to source |

### Requires a dedicated, browser-tested code change

| # | Gap | Plan |
|---|---|---|
| 10 | Admin MFA | [MFA_AND_CSP_PLAN.md](MFA_AND_CSP_PLAN.md) §1 |
| 11 | Strict CSP (remove `unsafe-inline`) | [MFA_AND_CSP_PLAN.md](MFA_AND_CSP_PLAN.md) §2 |
| 12 | Automated retention/deletion | Needs a reviewed data-class → table mapping and legal sign-off before enabling |

### Minor observations

- CI cannot currently be edited from this branch: the GitHub App lacks the
  `workflows` permission, so `.github/workflows/ci.yml` could not be updated to
  call `npm run check:all`. Until it is, CI still enumerates a subset of checks.
  The intended workflow is a single `npm run check:all` step after `npm ci`.
- `connectionTimeout: 0` leaves the incoming connection timeout disabled;
  `headersTimeout` (180s) bounds slow-header attacks.
- The React route `/react/dashboard` remains a migration workspace by design and
  is not a blocker for the canonical `/dashboard`.

## Bottom line

Every code-level blocker identified in the previous pass is now fixed and
covered by the aggregate gate. What remains is external operational evidence
(pen test, backup restore, secrets rotation, DB roles, legal sign-off,
monitoring) and two security controls that need a database and browser to
verify (MFA, strict CSP). Those should be completed before a go-live decision,
but the repository no longer has a red gate or an unguarded deploy path.
