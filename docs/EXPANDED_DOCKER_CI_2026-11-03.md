# The Fixer | Expanded self-hosted Docker CI (3 November 2026)

## Scope

This change expands existing PR #219 on `chore/manual-self-hosted-docker-ci-20261029`. The sole execution target is the reviewed `newchanges-ci` Ubuntu self-hosted runner. The workflow is manual-dispatch only; **no push/PR auto-trigger, hosted CI, production cutover, external database or production user accounts are involved**.

The main Compose test container joins an **internal Docker network**, shares the network namespace of a disposable `postgres:18-alpine` service and accepts only the fixed `postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci` URL. Production/cloud provider environment variables are prohibited and the network-isolation test attempts to connect to external addresses to verify egress is blocked.

## Release gates now included

| Gate | Implementation | Assertions |
| --- | --- | --- |
| Base quality | Existing lint, TypeScript, Vitest, build, Playwright, UI/contract checks | Fail on regressions |
| Security scanners | `scripts/ci/run-security-scanners.sh` (default enabled for manual runs) | Local tracked-file secret scan, npm advisories, Semgrep, Gitleaks, Trivy; pre-cached reviewed images needed |
| MFA | `scripts/admin-mfa-live-http-e2e.mjs`, existing MFA test collection | TOTP/passkey enrollment, two-superadmin approval, recovery proof mismatch, one-time proof consumption, session rotation/revocation and expired MFA step-up |
| API/roles | `scripts/ci/api-route-inventory.mjs`, `route-authorization-inventory-ci.mjs`, expanded live HTTP e2e | Automatic inventory of statically registered endpoints, mutation policy for every discovered route, real protected GET probes, viewer/anonymous denials, CSRF and headers |
| Import validation | `tests/ci/ingestion-faults.test.ts`, `adversarial-import-inputs.test.ts` | Bad CSV/JSON, unknown columns, invalid dates/counts, file duplicates, interrupted streaming callbacks |
| Import transactions | `scripts/ci/import-failure-integration-ci.mjs` | Real PostgreSQL valid load, stale watermark, duplicate rejection, double commit rejection and synthetic failure on stage chunk 2, with cleanup |
| DB resilience | `scripts/ci/database-resilience-ci.mjs` and existing Prisma/RLS integration checks | Rollback, uniqueness, optimistic locking, savepoint handling and disposable RLS policy checks |
| Database migration rehearsal | Workflow second disposable `newchanges_ci_migrations` database | `prisma migrate deploy` and `prisma migrate status`, followed by forced temporary DB removal |
| Database restore | Workflow `pg_dump` / `pg_restore` inside `postgres:18-alpine` | Restore into separate temporary database, compare number of public tables, discard dump/database |
| Visual regression | `scripts/ci/visual-regression-ci.mjs`, `console-ux-browser-check.mjs`, `mfa-design-contract.json` | Mobile/tablet/desktop layout, brand colour, required controls, touch target size, overflow, runtime exceptions, deterministic screenshots |
| Load | `scripts/ci/local-http-load-ci.mjs` | 180 localhost requests with 12 concurrent clients, no errors, 3s local p95 guard, bounded heap growth, admin authentication boundary |
| Offline/anti-regression | `tests/ci-docker-isolation.test.mjs`, `tests/ci/test-suite-coverage-contract.test.mjs`, runtime network test | Detect removed test gates, untrusted auto-triggers, privileged cloud env variables and unexpected outbound network access |
| Source sync / dashboards | Existing `run-circleci-verify-parity.sh` plus other check scripts | Interrupted sync recovery, source continuity, source reconciliation, scheduling, dashboards, responsive admin/user UI |

## Real bug fixed

`uploadAndValidate` previously allowed a streaming exception to leave already-written staging chunks attached to an `UPLOADED` batch. The importer now attempts to remove those chunks and marks the batch `FAILED` with a non-sensitive error description, then rethrows the original exception. If the database is unavailable throughout cleanup, the unvalidated `UPLOADED` status still prevents commitment. A disposable PostgreSQL trigger deliberately fails the second 2,000-row chunk and verifies that the original staged rows are discarded.

`parseDateTime` also now rejects impossible ISO calendar dates instead of allowing JavaScript to silently normalize source watermarks such as 30 February.

## How to execute

1. Open GitHub Actions > **NewChanges manual Docker CI (self-hosted only)**.
2. Select branch `chore/manual-self-hosted-docker-ci-20261029`. Leave `run_security_scanners=true` for the full security gate. Ensure the pinned Semgrep/Gitleaks/Trivy images are already reviewed and cached; npm audit requires working public advisory access.
3. Dispatch only after reviewing the branch. Confirm the job runs on `[self-hosted, linux, x64, newchanges-ci]`, **not** hosted infrastructure.
4. Inspect every gate's log, the isolated migration/restore steps and scanner report. On failure, the workflow copies screenshots/JSON from a named volume and uploads them for seven days; cleanup removes the test project's volumes.

### Mandatory release criteria

- The **latest branch commit** passes the entire manual job with the scanners enabled.
- The isolated test database and temporary migration/restore databases are removed.
- The source code, migration history, and observed authentication behaviour are reviewed before any production MFA enforcement or database cutover.
- No secrets, credentials, or production records appear in logs or artifacts.

### Limits that must not be presented as 100% measured coverage

This is broad **scenario coverage**. There is not yet a measured 100% statement/branch/endpoint coverage report, nor a user-reviewed golden PNG baseline across commits. Deterministic screenshot stability and a versioned MFA design contract are enforced, but exact cross-version screenshot comparison would require reviewed image baselines. Source parsing automatically classifies statically registered routes; dynamic registrations are separately flagged for review. The tests are committed but **not executed in the GitHub connector environment**. A passing latest-commit runner run is required to claim a successful verification.

No merge or deployment was performed.
