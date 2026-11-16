#!/usr/bin/env bash
# Read-only checks only. Does not dump, restore, or alter either database.
set -Eeuo pipefail
: "${DR_SOURCE_DATABASE_URL:?Set source URL in a secret environment}"
: "${DR_TARGET_DATABASE_URL:?Set target URL in a secret environment}"
command -v psql >/dev/null
if [[ "$DR_SOURCE_DATABASE_URL" == "$DR_TARGET_DATABASE_URL" ]]; then
  echo 'BLOCKED: identical source and target' >&2; exit 2
fi
check() {
  local label="$1" url="$2"
  echo "Inspecting $label (no credentials logged)"
  PGCONNECT_TIMEOUT=12 psql "$url" -X -v ON_ERROR_STOP=1 -A -t -c "SELECT current_setting('server_version_num'),pg_database_size(current_database()),(SELECT count(*) FROM pg_tables WHERE schemaname='public');"
  PGCONNECT_TIMEOUT=12 psql "$url" -X -v ON_ERROR_STOP=1 -A -t -c "SELECT extname,extversion FROM pg_extension ORDER BY extname;"
}
check source "$DR_SOURCE_DATABASE_URL"
check destination "$DR_TARGET_DATABASE_URL"
echo 'Read-only inspection complete. No authorization for copying or cutover.'
