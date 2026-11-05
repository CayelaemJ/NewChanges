#!/usr/bin/env bash
# Ubuntu WSL convenience entrypoint: run local GPU Ollama audit and export its
# private PDF to the signed-in Windows user's Downloads folder.
set -uo pipefail
cd "$(dirname "$0")/../.."
mkdir -p test-reports/ai-security
install -d -m 700 "$HOME/.cache/the-fixer-ollama"
echo "Running full local Ollama audit. Cached chunks will be reused."
docker compose -f docker-compose.ai-security.yml \
  run --build --rm --user "$(id -u):$(id -g)" ai-security-review
scan_status=$?
if [[ -f test-reports/ai-security/report.json ]]; then
  python3 scripts/ci/export-ollama-pdf.py
  export_status=$?
else
  echo "Scanner did not write report.json; no PDF can be exported." >&2
  export_status=1
fi
if (( scan_status != 0 )); then
  echo "The PDF includes incomplete scan status; investigate unresolved chunks." >&2
  exit "$scan_status"
fi
exit "$export_status"
