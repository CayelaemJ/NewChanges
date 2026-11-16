#!/usr/bin/env bash
# Metadata-only schema export. Never restores or changes either database.
set -Eeuo pipefail
: "${DR_SOURCE_DATABASE_URL:?Set source URL in a secret environment}"
command -v pg_dump >/dev/null
command -v pg_restore >/dev/null
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
umask 077
echo 'Creating temporary schema-only archive (no table rows)...'
PGCONNECT_TIMEOUT=12 pg_dump --dbname="$DR_SOURCE_DATABASE_URL" --schema-only --format=custom --no-owner --no-acl --file="$workdir/source-schema.dump"
pg_restore --list "$workdir/source-schema.dump" > "$workdir/toc.txt"
echo 'Schema archive created successfully.'
echo 'Potentially incompatible extension entries:'
grep -E 'EXTENSION|COMMENT - EXTENSION' "$workdir/toc.txt" || true
echo 'No restore was attempted. A PostgreSQL 17 isolated schema restore must pass separately.'
