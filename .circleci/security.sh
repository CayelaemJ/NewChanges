#!/usr/bin/env bash
set -Eeuo pipefail
mkdir -p security-reports "$HOME/.local/bin"
export PATH="$HOME/.local/bin:$PATH"

# Pinned scanner releases. Only passive repository scanning runs on CI.
curl -fsSL https://raw.githubusercontent.com/aquasecurity/trivy/v0.67.2/contrib/install.sh | sh -s -- -b "$HOME/.local/bin" v0.67.2
curl -fsSL https://github.com/gitleaks/gitleaks/releases/download/v8.24.3/gitleaks_8.24.3_linux_x64.tar.gz | tar -xz -C "$HOME/.local/bin" gitleaks
gitleaks version
trivy --version

failed=0
run_scan() {
  local scanner="$1"
  shift
  echo "=== ${scanner} ==="
  if "$@"; then
    printf '%s: PASS\n' "$scanner" >> security-reports/summary.txt
  else
    printf '%s: FAIL\n' "$scanner" >> security-reports/summary.txt
    failed=1
  fi
}

# Scan Git history with redacted output; do not publish extracted credentials.
run_scan gitleaks gitleaks git --redact --exit-code 1 --report-format json --report-path security-reports/gitleaks.json
# Trivy's secret scanner is deliberately excluded to avoid uploading raw secret matches.
# Current tracked-file secret coverage is independently enforced by credential_exposure_scan.
run_scan trivy trivy fs --scanners vuln,misconfig --severity HIGH,CRITICAL --exit-code 1 --format json --output security-reports/trivy.json .
cat security-reports/summary.txt
exit "$failed"
