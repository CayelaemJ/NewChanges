# Expanded isolated Docker CI tests (2026-11-03)

This addition extends the existing **manual, self-hosted** workflow and the disposable PostgreSQL 18 Docker Compose suite on PR #219. No hosted runners, deployment, source credentials, external databases, or production changes are introduced.

## Added checks

1. `scripts/ci/database-resilience-ci.mjs`: transaction rollback, constraint violations, concurrent optimistic locking, and savepoint recovery against a unique synthetic schema.
2. `scripts/admin-mfa-live-http-e2e.mjs`: additional **real Fastify HTTP** negative cases for anonymous access, password-only administrator reads, privileged recovery mutation, and unknown recovery requests. The existing virtual passkey/TOTP enrollment and two-superadmin recovery flows remain intact.
3. `tests/ci/ingestion-faults.test.ts`: malformed JSON, invalid CSV validation, interrupted CSV/JSON staging callbacks, and duplicate natural-key rejection against the actual import parser. These are parser-level fault injections, **not** a simulation of an entire source outage or multi-page database commit.
4. `scripts/ci/visual-regression-ci.mjs`: isolated Chromium rendering of the real MFA HTML/JS with mocked API responses across 320/390/768/1366px. Fails on page errors, horizontal overflow, and differing pixel output across two identical deterministic renders. Stores failure screenshots and a status report under `test-results/visual-regression/`.

## Run

Select the `chore/manual-self-hosted-docker-ci-20261029` branch and manually dispatch `.github/workflows/newchanges-manual-docker-ci.yml` on the dedicated `newchanges-ci` runner.

The existing `scripts/ci/run-docker-ci-suite.sh` runs all added checks; failures stop the job. The service uses the existing isolated Compose database, CI-only environment and pre-existing cleanup step.

## What remains to verify

- The committed tests have **not** been executed in this connector environment. The latest commit must pass on the Ubuntu runner.
- Visual consistency across two screenshots is not an approved image-baseline comparison. Add reviewed image baselines to detect intentional/unintentional visual redesigns.
- The ingestion fault tests verify errors propagate from parser/writer callbacks; they do not yet prove database-level import cleanup after a write outage, nor network-backed source timeouts.
- Extended HTTP checks cover selected protected endpoints, not a complete route-by-route authorization matrix.
- Inspect the self-hosted runner's logs and retained failure screenshots before release; do not merge or deploy solely on the presence of tests.

## Safety

Do not execute self-hosted workflows for untrusted pull requests or arbitrary forks. Runner host Docker permissions are powerful. Restrict access and review the selected branch before dispatch. Keep test traffic offline, the database disposable, and secrets absent.
