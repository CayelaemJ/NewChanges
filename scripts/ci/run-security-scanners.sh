#!/usr/bin/env bash
# Local-only self-hosted runner scanners. No deployment credentials.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
mkdir -p test-results/security
# Scan repository-tracked files (redacts values from output).
node --test scripts/security/scan-secrets.test.mjs
node scripts/security/scan-secrets.mjs
node --test scripts/security/summarize-scanner-report.test.mjs
# Dependency advisory lookup requires access to npm registry. Fail closed when unavailable.
node scripts/ci/audit-summary.mjs
# External images must be reviewed and cached before use; never mount Docker socket.
docker image inspect semgrep/semgrep:1.147.0 >/dev/null
docker image inspect aquasec/trivy:0.76.1 >/dev/null
docker image inspect zricethezav/gitleaks:v8.24.3 >/dev/null
# No network for scanners; updates to rule feeds require a separately approved preparation stage.
docker run --rm --network none --read-only --security-opt no-new-privileges --cap-drop ALL \
  -v "$PWD:/src:ro" -w /src semgrep/semgrep:1.147.0 \
  semgrep scan --config auto --error --metrics off --exclude node_modules --exclude dist .
docker run --rm --network none --read-only --security-opt no-new-privileges --cap-drop ALL \
  -v "$PWD:/src:ro" -w /src zricethezav/gitleaks:v8.24.3 \
  git --redact --exit-code 1
docker run --rm --network none --read-only --security-opt no-new-privileges --cap-drop ALL \
  -v "$PWD:/src:ro" -v newchanges-trivy-cache:/root/.cache/ --workdir /src \
  aquasec/trivy:0.76.1 fs --skip-db-update --scanners vuln,misconfig --severity HIGH,CRITICAL --exit-code 1 .
