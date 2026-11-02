#!/usr/bin/env bash
# Isolated PostgreSQL 17 schema compatibility trial. Does not modify Neon or Aiven.
set -Eeuo pipefail
: "${DR_SOURCE_DATABASE_URL:?Set source URL in a secret environment}"
for tool in pg_dump pg_restore docker awk sed; do
  command -v "$tool" >/dev/null || { echo "Missing: $tool" >&2; exit 2; }
done
pg_dump --version | grep -Eq 'PostgreSQL\) 18\.' || { echo 'Use PostgreSQL 18 pg_dump.' >&2; exit 2; }
pg_restore --version | grep -Eq 'PostgreSQL\) 18\.' || { echo 'Use PostgreSQL 18 pg_restore.' >&2; exit 2; }
docker image inspect postgres:17-alpine >/dev/null 2>&1 || { echo 'Local postgres:17-alpine image required; no pull attempted.' >&2; exit 2; }
umask 077
workdir="$(mktemp -d)"
cid=''
cleanup() {
  if [[ -n "$cid" ]]; then docker rm -f "$cid" >/dev/null 2>&1 || true; fi
  rm -rf "$workdir"
}
trap cleanup EXIT
PGCONNECT_TIMEOUT=12 pg_dump --dbname="$DR_SOURCE_DATABASE_URL" --schema-only --format=custom --no-owner --no-acl --file="$workdir/schema.dump"
pg_restore --list "$workdir/schema.dump" > "$workdir/schema.toc"
# Exclude vendor extensions only in disposable trial. Real dependencies must fail.
awk '
  /^[0-9]+; [0-9]+ [0-9]+ EXTENSION - (pg_session_jwt|pg_stat_statements) / {print ";" $0; next}
  /^[0-9]+; [0-9]+ [0-9]+ COMMENT - EXTENSION (pg_session_jwt|pg_stat_statements) / {print ";" $0; next}
  {print}
' "$workdir/schema.toc" > "$workdir/filtered.toc"
pg_restore --schema-only --use-list="$workdir/filtered.toc" --no-owner --no-acl --file="$workdir/schema.sql" "$workdir/schema.dump"
# PostgreSQL 18 client-only meta commands are not understood by PG17 psql.
sed -i '/^\\restrict /d; /^\\unrestrict /d' "$workdir/schema.sql"
# Test container cannot reach external networks, and has no published port.
cid="$(docker run --detach --rm --network none --env POSTGRES_HOST_AUTH_METHOD=trust postgres:17-alpine)"
ready=0
for _ in $(seq 1 30); do
  if docker exec "$cid" pg_isready -U postgres -d postgres >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
[[ "$ready" == 1 ]] || { echo 'Isolated PostgreSQL 17 did not start.' >&2; exit 2; }
if ! docker exec -i "$cid" psql -X -v ON_ERROR_STOP=1 -U postgres -d postgres < "$workdir/schema.sql" > "$workdir/restore.log" 2>&1; then
  echo 'FAIL: PostgreSQL 17 rejected the schema. No live databases changed.' >&2
  exit 3
fi
tables="$(docker exec "$cid" psql -XAtqc "SELECT count(*) FROM pg_tables WHERE schemaname='public'" -U postgres -d postgres)"
echo "PASS: disposable PostgreSQL 17 schema restore; public tables=$tables."
echo 'No data copied; compatibility does not authorize production cutover.'
