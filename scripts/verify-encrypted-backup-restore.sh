#!/usr/bin/env bash
# Local-only PostgreSQL 18 restoration drill for a private encrypted pg_dump archive.
# No network, no published port, no connections to Neon/Aiven.
set -Eeuo pipefail
umask 077
if [[ $# -ne 1 || ! -f "$1" ]]; then
  echo "Usage: AGE_IDENTITY_FILE=/private/path/age-key.txt bash scripts/verify-encrypted-backup-restore.sh /path/archive.pgdump.age" >&2
  exit 2
fi
: "${AGE_IDENTITY_FILE:?AGE_IDENTITY_FILE is required (private key path, do not paste it)}"
if [[ ! -f "$AGE_IDENTITY_FILE" ]]; then
  echo "BLOCKED: age identity file does not exist" >&2
  exit 2
fi
for binary in docker age; do
  if ! command -v "$binary" >/dev/null 2>&1; then
    echo "BLOCKED: $binary is not installed" >&2
    exit 2
  fi
done
docker image inspect postgres:18-alpine >/dev/null
CONTAINER="fixer-backup-restore-${BASHPID}"
# Keep the stopped container available until error diagnostics are captured.
# All operations remain local to this temporary, network-disabled container.
RESTORE_STAGE="container startup"
diagnostics() {
  local rc="$?"
  trap - ERR
  echo "BLOCKED: isolated PostgreSQL 18 restore failed at stage: $RESTORE_STAGE (exit=$rc)." >&2
  if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
    docker inspect --format 'Container status={{.State.Status}} exit={{.State.ExitCode}} oom_killed={{.State.OOMKilled}} error={{.State.Error}}' "$CONTAINER" >&2 || true
    echo "Recent isolated PostgreSQL container logs (may contain internal SQL details, redact before sharing):" >&2
    docker logs --tail 30 "$CONTAINER" >&2 || true
  else
    echo "Docker container unavailable for inspection; check Docker Desktop / WSL resources." >&2
  fi
  exit "$rc"
}
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
trap diagnostics ERR
# Avoid the prior 768 MB cap, which can kill PostgreSQL during index rebuilds.
# Enforce a bounded, local-only 2 GiB maximum. This does not change Aiven limits.
docker run -d --network none --name "$CONTAINER" --memory 2g --shm-size 256m \
  --env POSTGRES_PASSWORD=synthetic-restore-only \
  --env POSTGRES_DB=restorecheck postgres:18-alpine >/dev/null
RESTORE_STAGE="PostgreSQL final-server readiness"
# The official postgres image briefly runs a temporary setup server, creates
# POSTGRES_DB, deliberately shuts that server down, then execs the final one.
# pg_isready can report ready against the temporary server, so never use it as
# evidence that the actual restore database is ready.
ready=false
for i in $(seq 1 90); do
  if docker logs "$CONTAINER" 2>&1 | grep -Fq 'PostgreSQL init process complete; ready for start up.'; then
    if docker exec "$CONTAINER" psql -X -q -A -t -v ON_ERROR_STOP=1 \
      -U postgres -d restorecheck -c 'SELECT 1' 2>/dev/null | grep -qx '1'; then
      ready=true
      break
    fi
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "BLOCKED: final isolated PostgreSQL server did not become SQL-ready" >&2
  exit 2
fi
# A fresh PG18 database already includes public. Some dumps include a
# CREATE SCHEMA public entry (portable Neon); others omit it (full Aiven).
# Inspect the encrypted archive's table-of-contents first, without ever
# materializing a plaintext archive on disk or connecting to production.
# pg_restore --list only consumes the archive header/catalog and exits early.
# Drain the rest of age's decrypted stream after pg_restore exits so age can
# complete authenticated decryption instead of dying with SIGPIPE (141).
# Keep pipefail enabled: an incorrect key, corrupt archive or pg_restore failure
# must still stop the drill. No plaintext archive is written to disk.
RESTORE_STAGE="encrypted archive catalog inspection"
echo "Inspecting encrypted archive catalog in disposable PG18 (streamed; no local plaintext)..."
archive_catalog="$(age -d -i "$AGE_IDENTITY_FILE" "$1" | {
  docker exec -i "$CONTAINER" pg_restore --list
  cat > /dev/null
})"
if grep -Eq '^[[:space:]]*[0-9]+;.*[[:space:]]SCHEMA - public([[:space:]]|$)' <<< "$archive_catalog"; then
  echo "Archive defines public schema; removing only empty default schema in disposable database."
  docker exec "$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d restorecheck \
    -c 'DROP SCHEMA public RESTRICT;'
else
  echo "Archive does not define public schema; keeping default empty schema."
fi
unset archive_catalog
RESTORE_STAGE="pg_restore data/index reconstruction"
echo "Restoring encrypted archive into disposable offline PostgreSQL 18..."
# pipefail ensures a decrypt failure or pg_restore failure cannot be treated as success.
age -d -i "$AGE_IDENTITY_FILE" "$1" | \
  docker exec -i "$CONTAINER" pg_restore --exit-on-error --no-owner --no-acl \
    -U postgres -d restorecheck
RESTORE_STAGE="restored schema and application-table checks"
table_count=$(docker exec "$CONTAINER" psql -X -q -A -t -U postgres -d restorecheck \
  -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
if [[ "$table_count" != 57 ]]; then
  echo "BLOCKED: restored public table inventory is $table_count, expected 57" >&2
  exit 2
fi
docker exec "$CONTAINER" psql -X -q -A -t -U postgres -d restorecheck \
  -c 'SELECT count(*) FROM public."DataAccessEvent";' >/dev/null
docker exec "$CONTAINER" psql -X -q -A -t -U postgres -d restorecheck \
  -c 'SELECT count(*) FROM public."Session";' >/dev/null
echo "PASS: encrypted archive decrypted and restored all 57 public tables in disposable PG18."
echo "No production database or network accessed. Keep restore evidence separate from Git and protect the encryption identity."
