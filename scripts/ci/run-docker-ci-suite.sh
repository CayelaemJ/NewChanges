#!/bin/sh
# Run inside the isolated NewChanges Compose 'tests' container only.
set -eu
: "${CI:?CI must be set}"
: "${DATABASE_URL:?A disposable PostgreSQL DATABASE_URL is required}"
case "$DATABASE_URL" in
  postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci) ;;
  *) echo "Refusing non-disposable database URL" >&2; exit 2 ;;
esac
[ "${CI_RLS_PROBE_APPROVED:-}" = "CI_DISPOSABLE_ONLY" ] || { echo "Missing disposable RLS guard" >&2; exit 2; }
[ "${ENABLE_SEMANTIC_OBJECT_PUBLISH:-}" = "false" ] || exit 2
[ "${ENABLE_SEMANTIC_SHADOW_WORKER:-}" = "false" ] || exit 2
run() { echo ">>> RUN $1"; "$@"; echo "<<< PASS $1"; }
run npm run quality:lint
run node scripts/password-form-contract-check.mjs
run npm run quality:types
run npm run quality:unit
run npm run db:generate
run ./node_modules/.bin/tsc
run npm run build --prefix frontend
run npm run check:production
run npm run check:security
run node --test tests/security/admin-mfa-policy.test.mjs
run npm run check:security-identity
run npm run check:security-operations
run npm run check:security-governance
run npm run check:source-sync-safety
run npm run check:accessibility
run npm run check:performance
run npm run check:semantic-planner
run npm run check:semantic-storage
run npm run check:source-vault
run npm run check:source-continuity
run npm run check:source-reconciliation
run node scripts/security/rls-isolation-ci-probe.mjs
run node scripts/prisma-upgrade-integration.mjs
run sh scripts/ci/run-circleci-verify-parity.sh
run npm run quality:e2e
run node scripts/console-ux-browser-check.mjs
run node scripts/header-responsive-check.mjs
run node scripts/admin-browser-smoke.mjs
echo "All configured Docker CI groups passed."
