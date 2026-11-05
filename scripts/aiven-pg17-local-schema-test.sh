#!/usr/bin/env bash
# Isolated PostgreSQL 17 schema compatibility trial. Does not modify Neon or Aiven.
set -Eeuo pipefail
: "${DR_SOURCE_DATABASE_URL:?Set source URL in a secret environment}"
for tool in pg_dump pg_restore docker sed grep; do
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
PGCONNECT_TIMEOUT=12 pg_dump --dbname="$DR_SOURCE_DATABASE_URL" --schema-only --schema=public --format=custom --exclude-extension=pg_session_jwt --exclude-extension=pg_stat_statements --no-owner --no-acl --file="$workdir/schema.dump"
pg_restore --list "$workdir/schema.dump" > "$workdir/schema.toc"
expected_tables="$(grep -Ec '^[0-9]+; [0-9]+ [0-9]+ TABLE public ' "$workdir/schema.toc" || true)"
if [[ ! "$expected_tables" =~ ^[0-9]+$ ]] || (( expected_tables == 0 )); then
  echo 'BLOCKED: no public application tables found in the schema archive.' >&2
  exit 2
fi
# PostgreSQL 18 pg_dump supports --exclude-extension; the archive was made
# without vendor extensions. PostgreSQL 17 does not recognize PG18 client
# session guard commands; remove only those known compatibility wrappers.
pg_restore --schema-only --no-owner --no-acl --file="$workdir/schema.sql" "$workdir/schema.dump"
sed -i '/^\\restrict /d; /^\\unrestrict /d; /^SET transaction_timeout = 0;/d' "$workdir/schema.sql"
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
if [[ "$tables" != "$expected_tables" ]]; then
  echo "FAIL: public table count mismatch; expected=$expected_tables restored=$tables" >&2
  exit 3
fi
echo "PASS: disposable PostgreSQL 17 schema restore; public tables=$tables."
echo 'No data copied; compatibility does not authorize production cutover.'
