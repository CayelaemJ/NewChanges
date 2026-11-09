#!/usr/bin/env bash
# Prepare the security scanner images for the personal Docker runner.
# This makes network operations explicit, separate from scanning.
set -Eeuo pipefail
docker pull semgrep/semgrep:1.147.0
docker pull zricethezav/gitleaks:v8.24.3
docker pull aquasec/trivy:0.76.1
printf '\nScanner images are present. This does not mean scans passed.\n'
