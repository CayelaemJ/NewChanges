#!/usr/bin/env bash
# Offline, full-data PostgreSQL 18 restore trial. Source is read-only.
# Target is a disposable, network-isolated Docker container, NEVER Aiven.
set -Eeuo pipefail

if [[ "${1:-}" != "--execute" ]]; then
  echo 'NO-OP: pass --execute to run the disposable local full-data trial.'
  exit 0
fi

: "${DR_SOURCE_DATABASE_URL:?Set a Neon source connection string in your local environment}"
[[ "${AIVEN_LOCAL_DATA_TRIAL_APPROVED:-}" == YES ]] || {
  echo 'BLOCKED: AIVEN_LOCAL_DATA_TRIAL_APPROVED=YES required.' >&2
  exit 2
}
for tool in pg_dump pg_restore psql docker node grep; do
  command -v "$tool" >/dev/null || { echo "Missing command: $tool" >&2; exit 2; }
done
for tool in pg_dump pg_restore; do
  "$tool" --version | grep -Eq 'PostgreSQL\) 18\.' || {
    echo "BLOCKED: PostgreSQL 18 $tool required." >&2; exit 2;
  }
done
docker image inspect postgres:18-alpine >/dev/null 2>&1 || {
  echo 'BLOCKED: local postgres:18-alpine image missing. No automatic pull.' >&2; exit 2;
}

# Fail closed if this is accidentally pointed at Aiven or another database.
src_identity="$(node --input-type=module -e '
  const u = new URL(process.env.DR_SOURCE_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(u.protocol)) process.exit(2);
  process.stdout.write(u.hostname.toLowerCase() + "|" + u.pathname.slice(1));
')"
[[ "$src_identity" == *.neon.tech\|newchanges ]] || {
  echo 'BLOCKED: source is not the expected Neon newchanges database.' >&2; exit 2;
}
source_pg="$(PGCONNECT_TIMEOUT=12 psql "$DR_SOURCE_DATABASE_URL" -XAtv ON_ERROR_STOP=1 -c 'SHOW server_version_num')"
[[ "$source_pg" =~ ^18[0-9]+$ ]] || {
  echo 'BLOCKED: source must be PostgreSQL 18.' >&2; exit 2;
}

umask 077
workdir="$(mktemp -d)"
cid=''
cleanup() {
  if [[ -n "$cid" ]]; then docker rm -f "$cid" >/dev/null 2>&1 || true; fi
  rm -rf -- "$workdir"
}
trap cleanup EXIT

echo 'Exporting one consistent snapshot of public application tables and data to temporary local storage.'
# The archive is always deleted by cleanup. No live database is ever written.
PGCONNECT_TIMEOUT=12 pg_dump --dbname="$DR_SOURCE_DATABASE_URL" \
  --schema=public --format=custom --compress=6 --no-owner --no-acl \
  --exclude-extension=pg_session_jwt --exclude-extension=pg_stat_statements \
  --file="$workdir/snapshot.dump"
pg_restore --list "$workdir/snapshot.dump" > "$workdir/snapshot.toc"
expected_tables="$(grep -Ec '^[0-9]+; [0-9]+ [0-9]+ TABLE public ' "$workdir/snapshot.toc" || true)"
[[ "$expected_tables" =~ ^[0-9]+$ && "$expected_tables" -gt 0 ]] || {
  echo 'BLOCKED: archive does not contain application tables.' >&2; exit 2;
}

echo 'Restoring archive inside disposable, network-isolated PostgreSQL 18 container.'
cid="$(docker run --detach --rm --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:18-alpine)"
ready=0
for _ in $(seq 1 45); do
  if docker exec "$cid" pg_isready -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'FAIL: isolated PostgreSQL did not start.' >&2; exit 3; }

# Docker's default template already defines public; pg_dump includes CREATE SCHEMA.
# This DROP is exclusively against the ephemeral container (no port, no network).
docker exec "$cid" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c 'DROP SCHEMA IF EXISTS public CASCADE;' >/dev/null
if ! docker exec -i "$cid" pg_restore -U postgres -d postgres \
  --no-owner --no-acl --exit-on-error --single-transaction \
  < "$workdir/snapshot.dump" > "$workdir/restore.log" 2>&1; then
  echo 'FAIL: local full-data restore failed. No live databases changed.' >&2
  grep -E '(ERROR|FATAL):' "$workdir/restore.log" |
    sed -E 's/^.*(ERROR|FATAL):[[:space:]]*/\1: /' | head -n 15 >&2 || true
  exit 3
fi

local_sql() {
  docker exec "$cid" psql -XAtv ON_ERROR_STOP=1 -U postgres -d postgres -c "$1"
}
source_sql() {
  PGCONNECT_TIMEOUT=12 psql "$DR_SOURCE_DATABASE_URL" -XAtv ON_ERROR_STOP=1 -c "$1"
}
restored_tables="$(local_sql "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
[[ "$restored_tables" == "$expected_tables" ]] || {
  echo "FAIL: application table mismatch; archive=$expected_tables restored=$restored_tables" >&2; exit 3;
}

# Compare each public table using values from the snapshot archive. Source live
# counts are also checked, but concurrent Neon writes may introduce drift.
tables_to_check="$(source_sql "SELECT format('%I.%I',schemaname,tablename) FROM pg_tables WHERE schemaname='public' ORDER BY tablename")"
[[ -n "$tables_to_check" ]] || { echo 'FAIL: no source tables to compare.' >&2; exit 3; }
checked=0
mismatches=0
while IFS= read -r table; do
  [[ -n "$table" ]] || continue
  source_count="$(source_sql "SELECT count(*) FROM $table")"
  restored_count="$(local_sql "SELECT count(*) FROM $table")"
  checked=$((checked + 1))
  if [[ "$source_count" != "$restored_count" ]]; then
    echo "COUNT DRIFT: $table (source now=$source_count, restored=$restored_count)" >&2
    mismatches=$((mismatches + 1))
  fi
done <<< "$tables_to_check"
[[ "$checked" == "$expected_tables" ]] || {
  echo "FAIL: source and archive table counts differ (source=$checked, archive=$expected_tables)." >&2
  exit 3
}

restored_bytes="$(local_sql "SELECT pg_database_size(current_database())")"
archive_bytes="$(stat -c '%s' "$workdir/snapshot.dump")"
echo "LOCAL RESTORE COMPLETE: public tables=$restored_tables, database bytes=$restored_bytes, compressed archive bytes=$archive_bytes."
if [[ "$mismatches" != 0 ]]; then
  echo "WARN: $mismatches source/live count differences; source may have changed during test or restore requires review." >&2
  exit 4
fi
echo "PASS: full-data PostgreSQL 18 local restore; $checked table counts match current source."
echo 'No Aiven writes. No production changes. Archive and Docker container are deleted on exit.'
