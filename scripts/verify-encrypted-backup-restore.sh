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
CONTAINER="fixer-backup-restore-$$"
cleanup() { docker rm -f "$CONTAINER" >/dev/null 2>&1 || true; }
trap cleanup EXIT
docker run -d --rm --network none --name "$CONTAINER" --memory 768m \
  --env POSTGRES_PASSWORD=synthetic-restore-only \
  --env POSTGRES_DB=restorecheck postgres:18-alpine >/dev/null
ready=false
for i in $(seq 1 50); do
  if docker exec "$CONTAINER" pg_isready -q -U postgres -d restorecheck; then
    ready=true
    break
  fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo "BLOCKED: isolated restore PostgreSQL failed to start" >&2
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
echo "Restoring encrypted archive into disposable offline PostgreSQL 18..."
# pipefail ensures a decrypt failure or pg_restore failure cannot be treated as success.
age -d -i "$AGE_IDENTITY_FILE" "$1" | \
  docker exec -i "$CONTAINER" pg_restore --exit-on-error --no-owner --no-acl \
    -U postgres -d restorecheck
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
