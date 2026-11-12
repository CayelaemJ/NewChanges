#!/usr/bin/env bash
# Local/self-hosted only. Never reaches real Neon/Aiven, never sets deployment variables.
set -Eeuo pipefail
umask 077
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PROJECT="fixer-mfa-verify-${BASHPID}"
COMPOSE=(docker compose -p "$PROJECT" -f docker-compose.mfa-e2e.yml)
cleanup() {
  "${COMPOSE[@]}" down --remove-orphans --volumes >/dev/null 2>&1 || true
}
failure() {
  local rc=$?
  trap - ERR
  echo "MFA INTEGRATION RESULT: FAIL (exit=$rc)" >&2
  exit "$rc"
}
trap cleanup EXIT
trap failure ERR

echo "STAGE 1/4: MFA release source gate..."
node scripts/production-auth-cutover-gate.mjs
echo "PASS: MFA release source gate"

echo "STAGE 2/4: Build isolated MFA regression image and compile TypeScript..."
docker build --pull=false -f Dockerfile.mfa-integration-test -t fixer-mfa-integration:preflight .
echo "PASS: TypeScript and Prisma generated-client build"

echo "STAGE 3/4: Run MFA unit, recovery, route and configuration tests without network..."
docker run --rm --network none --memory 2g --cpus 2 fixer-mfa-integration:preflight
echo "PASS: isolated MFA unit and configuration suites"

echo "STAGE 4/4: Disposable PostgreSQL 18 + HTTP/Chromium virtual authenticator..."
"${COMPOSE[@]}" up --build --abort-on-container-exit --exit-code-from mfa
echo "PASS: disposable MFA HTTP, authenticator and recovery E2E"

echo "MFA INTEGRATION RESULT: PASS (all four stages)"
echo "NOT A PRODUCTION CUTOVER APPROVAL. Full Neon recovery and tenant testing remain mandatory."
