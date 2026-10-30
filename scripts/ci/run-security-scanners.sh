#!/usr/bin/env bash
# Local-only self-hosted runner scanners. No deployment credentials.
set -Eeuo pipefail
cd "$(dirname "$0")/../.."
mkdir -p test-results/security
# Scan repository-tracked files (redacts values from output).
docker run --rm --network none -v "$PWD:/src:ro" -w /src node:24-slim node --test scripts/security/scan-secrets.test.mjs
# Secret scanner uses git ls-files: run with git available on the runner, not in a Git-excluded build context.
node_cmd() { docker run --rm --network none -v "$PWD:/src:ro" -w /src node:24-slim node "$@"; }
node_cmd --test scripts/security/summarize-scanner-report.test.mjs
# Dependency advisory lookup requires access to npm registry. Fail closed when unavailable.
docker run --rm -v "$PWD:/src:ro" -w /src node:24-slim npm audit --package-lock-only --audit-level=high
docker run --rm -v "$PWD:/src:ro" -w /src/frontend node:24-slim npm audit --package-lock-only --audit-level=high
# External images must be reviewed and cached before use; never mount Docker socket.
docker image inspect semgrep/semgrep:1.147.0 >/dev/null
docker image inspect aquasec/trivy:0.76.1 >/dev/null
docker image inspect zricethezav/gitleaks:v8.24.3 >/dev/null
# No network for scanners; updates to rule feeds require a separately approved preparation stage.
docker run --rm \
  -v "$PWD:/src:ro" -w /src semgrep/semgrep:1.147.0 \
  semgrep scan --config p/javascript --config p/typescript --config p/security-audit --error --metrics off --exclude node_modules --exclude dist .
docker run --rm \
  -v "$PWD:/src:ro" -w /src zricethezav/gitleaks:v8.24.3 \
  git --redact --exit-code 1
docker run --rm \
  -v "$PWD:/src:ro" -v newchanges-trivy-cache:/root/.cache/ --workdir /src \
  aquasec/trivy:0.76.1 fs --scanners vuln,misconfig --severity HIGH,CRITICAL --exit-code 1 .
