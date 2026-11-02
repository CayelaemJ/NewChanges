#!/usr/bin/env bash
# Safely prepare an Aiven PostgreSQL 17 -> 18 upgrade without changing plan.
# Run on your own machine after 'avn user login' (never paste credentials here).
# Default: print instructions only. --check submits Aiven's upgrade_check task;
# --upgrade requires a completed successful task and an explicit confirmation.
set -Eeuo pipefail

service=the-fixer-postgres
project=cay-bed7
target_version=18
if [[ "${1:-}" != "--check" && "${1:-}" != "--upgrade" ]]; then
  cat <<'HELP'
Aiven PostgreSQL 18 version alignment:
  1. Install Aiven CLI and sign in locally with: avn user login
  2. Run: bash scripts/aiven-pg18-upgrade.sh --check
  3. Inspect the returned task ID and status:
       avn service task-get the-fixer-postgres --project cay-bed7 --task-id TASK_ID
  4. Only once status DONE and success true, verify the service is STILL free-1-1gb
     in do-blr, then explicitly run: bash scripts/aiven-pg18-upgrade.sh --upgrade
This script never creates a new service, changes plan, or deletes data.
HELP
  exit 0
fi
command -v avn >/dev/null || { echo "Aiven CLI missing. Install it and sign in locally." >&2; exit 2; }

if [[ "$1" == "--check" ]]; then
  echo 'Requesting Aiven PostgreSQL 18 compatibility check on the existing service.'
  avn service task-create "$service" --project "$project" --operation upgrade_check --target-version "$target_version"
  echo 'Review the task result before any upgrade. A successful check expires after one hour.'
  exit 0
fi

[[ "${AIVEN_PG18_UPGRADE_APPROVED:-}" == "YES" ]] || {
  echo 'BLOCKED: set AIVEN_PG18_UPGRADE_APPROVED=YES only after verifying upgrade_check success and free plan.' >&2
  exit 2
}
# Operator must verify version, service, region and plan in the Console after the check.
read -r -p 'Confirm upgrade of existing empty Aiven service to PG18 (type UPGRADE-EXISTING-FREE): ' typed
[[ "$typed" == "UPGRADE-EXISTING-FREE" ]] || { echo 'Aborted.' >&2; exit 2; }
avn service update "$service" --project "$project" -c pg_version="$target_version"
echo 'Upgrade request submitted. Verify PostgreSQL 18, free-1-1gb, do-blr and RUNNING before any restore.'
