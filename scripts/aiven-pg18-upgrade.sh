#!/usr/bin/env bash
# Safely prepare an Aiven PostgreSQL 17 -> 18 upgrade without changing plan.
# Run on your own machine after 'avn user login' (never paste credentials here).
# Default: print instructions only. --check submits Aiven's upgrade_check task.
# --upgrade verifies the supplied task ID reports successful upgrade_check before proceeding.
set -Eeuo pipefail

service=the-fixer-postgres
project=cay-bed7
target_version=18
if [[ "${1:-}" != "--check" && "${1:-}" != "--upgrade" ]]; then
  cat <<'HELP'
Aiven PostgreSQL 18 version alignment:
  1. Install Aiven CLI and sign in locally with: avn user login
  2. Run: bash scripts/aiven-pg18-upgrade.sh --check
  3. Copy the returned task ID. Confirm the result is DONE and successful:
       avn service task-get --task-id TASK_ID --project cay-bed7 the-fixer-postgres
  4. Verify the service is still free-1-1gb in do-blr. Then run:
       AIVEN_PG18_CHECK_TASK_ID=TASK_ID AIVEN_PG18_UPGRADE_APPROVED=YES bash scripts/aiven-pg18-upgrade.sh --upgrade
This script never creates a new service, changes plan, or deletes data.
HELP
  exit 0
fi
command -v avn >/dev/null || { echo "Aiven CLI missing. Install it and sign in locally." >&2; exit 2; }
command -v python3 >/dev/null || { echo "Python 3 is required to verify the Aiven task JSON." >&2; exit 2; }

if [[ "$1" == "--check" ]]; then
  echo 'Requesting Aiven PostgreSQL 18 compatibility check on the existing service.'
  avn service task-create "$service" --project "$project" --operation upgrade_check --target-version "$target_version" --json
  echo 'Review the task result before any upgrade. A successful check expires after one hour.'
  exit 0
fi

[[ "${AIVEN_PG18_UPGRADE_APPROVED:-}" == "YES" ]] || {
  echo 'BLOCKED: set AIVEN_PG18_UPGRADE_APPROVED=YES only after verifying upgrade_check success and free plan.' >&2
  exit 2
}
check_task_id="${AIVEN_PG18_CHECK_TASK_ID:-}"
[[ "$check_task_id" =~ ^[A-Za-z0-9-]{8,128}$ ]] || {
  echo 'BLOCKED: set AIVEN_PG18_CHECK_TASK_ID to the successful compatibility-check task ID.' >&2
  exit 2
}
task_json="$(avn service task-get --task-id "$check_task_id" --project "$project" "$service" --json)" || {
  echo 'BLOCKED: could not retrieve the Aiven compatibility-check task.' >&2
  exit 2
}
if ! printf '%s' "$task_json" | python3 -c '
import json, sys
from datetime import datetime, timezone
expected = sys.argv[1]
try:
    payload = json.load(sys.stdin)
except Exception:
    raise SystemExit(2)
matches = []
def visit(value):
    if isinstance(value, dict):
        if value.get("task_id") == expected:
            matches.append(value)
        for child in value.values():
            visit(child)
    elif isinstance(value, list):
        for child in value:
            visit(child)
visit(payload)
if len(matches) != 1:
    raise SystemExit(2)
task = matches[0]
if task.get("success") is not True:
    raise SystemExit(2)
if "upgrade_check" not in str(task.get("task_type", "")).lower():
    raise SystemExit(2)
created = task.get("create_time")
if not isinstance(created, str):
    raise SystemExit(2)
try:
    created_at = datetime.fromisoformat(created.replace("Z", "+00:00"))
except ValueError:
    raise SystemExit(2)
if created_at.tzinfo is None:
    raise SystemExit(2)
age = (datetime.now(timezone.utc) - created_at.astimezone(timezone.utc)).total_seconds()
if age < 0 or age > 3600:
    raise SystemExit(2)
' "$check_task_id"; then
  echo 'BLOCKED: task ID is not a successful Aiven PostgreSQL upgrade_check.' >&2
  exit 2
fi
# Operator must still verify the service remains free-1-1gb in do-blr.
read -r -p 'Confirm upgrade of the existing Aiven service to PG18 (type UPGRADE-EXISTING-FREE): ' typed
[[ "$typed" == "UPGRADE-EXISTING-FREE" ]] || { echo 'Aborted.' >&2; exit 2; }
avn service update "$service" --project "$project" -c pg_version="$target_version"
echo 'Upgrade request submitted. Verify PostgreSQL 18, free-1-1gb, do-blr and RUNNING before any restore.'
