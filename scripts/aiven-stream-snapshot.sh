#!/usr/bin/env bash
# The Fixer: one-shot snapshot copy to existing Aiven PostgreSQL 18.
# This script NEVER changes application config or deletes a database.
# Without --execute it makes no connections and moves no records.
set -Eeuo pipefail

if [[ "${1:-}" != "--execute" ]]; then
  echo 'NO-OP: provide --execute only after every migration gate is approved.'
  echo 'Source and target credentials must be supplied by the operator as environment secrets.'
  exit 0
fi

require_approval() {
  local key="$1"
  if [[ "${!key:-}" != "YES" ]]; then
    echo "BLOCKED: explicit ${key}=YES approval is required." >&2
    exit 2
  fi
}
require_approval AIVEN_SOURCE_CONFIRMED
require_approval AIVEN_FREE_PLAN_VERIFIED
require_approval AIVEN_DISK_HEADROOM_VERIFIED
require_approval AIVEN_BACKUP_VERIFIED
require_approval AIVEN_EXTENSION_REVIEWED
require_approval AIVEN_CROSS_BORDER_APPROVED
require_approval AIVEN_WRITES_FROZEN
require_approval AIVEN_SNAPSHOT_COPY_APPROVED

: "${DR_SOURCE_DATABASE_URL:?Missing source connection secret}"
: "${DR_TARGET_DATABASE_URL:?Missing target connection secret}"
for tool in node psql pg_dump pg_restore awk cmp grep; do
  command -v "$tool" >/dev/null || { echo "Missing: $tool" >&2; exit 2; }
done
pg_dump --version | grep -Eq 'PostgreSQL\) 18\.' ||
  { echo 'BLOCKED: PostgreSQL 18 pg_dump is required.' >&2; exit 2; }
pg_restore --version | grep -Eq 'PostgreSQL\) 18\.' ||
  { echo 'BLOCKED: PostgreSQL 18 pg_restore is required.' >&2; exit 2; }

# Parse endpoints without printing credentials, tokens, or complete URLs.
endpoint() {
  node --input-type=module -e '
    const u = new URL(process.env[process.argv[1]]);
    if (!["postgres:","postgresql:"].includes(u.protocol)) process.exit(2);
    process.stdout.write(u.hostname.toLowerCase() + "|" + u.pathname.slice(1));
  ' "$1"
}
src_id="$(endpoint DR_SOURCE_DATABASE_URL)"
dst_id="$(endpoint DR_TARGET_DATABASE_URL)"
[[ "$src_id" != "$dst_id" ]] || { echo 'BLOCKED: identical database endpoints.' >&2; exit 2; }
[[ "$src_id" == *.neon.tech\|newchanges ]] ||
  { echo 'BLOCKED: unexpected Neon source endpoint or database name.' >&2; exit 2; }
[[ "$dst_id" == 'the-fixer-postgres-cay-bed7.b.aivencloud.com|defaultdb' ]] ||
  { echo 'BLOCKED: destination is not the approved Aiven free service.' >&2; exit 2; }

sql() {
  local env_key="$1" query="$2"
  PGCONNECT_TIMEOUT=12 psql "${!env_key}" -X -q -A -t -v ON_ERROR_STOP=1 -c "$query"
}
source_version="$(sql DR_SOURCE_DATABASE_URL 'SHOW server_version_num')"
target_version="$(sql DR_TARGET_DATABASE_URL 'SHOW server_version_num')"
[[ "$source_version" =~ ^[0-9]+$ && "$target_version" =~ ^[0-9]+$ ]] ||
  { echo 'BLOCKED: unable to parse database versions.' >&2; exit 2; }
[[ $((source_version / 10000)) -eq 18 && $((target_version / 10000)) -eq 18 ]] ||
  { echo 'BLOCKED: both databases must run PostgreSQL 18; downgrade is not allowed.' >&2; exit 2; }

source_bytes="$(sql DR_SOURCE_DATABASE_URL 'SELECT pg_database_size(current_database())')"
target_tables="$(sql DR_TARGET_DATABASE_URL "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")"
target_views="$(sql DR_TARGET_DATABASE_URL "SELECT count(*) FROM pg_views WHERE schemaname NOT IN ('pg_catalog','information_schema')")"
target_bytes="$(sql DR_TARGET_DATABASE_URL 'SELECT pg_database_size(current_database())')"
source_tables="$(sql DR_SOURCE_DATABASE_URL "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
[[ "$source_bytes" =~ ^[0-9]+$ && "$target_tables" =~ ^[0-9]+$ && "$target_views" =~ ^[0-9]+$ && "$target_bytes" =~ ^[0-9]+$ && "$source_tables" =~ ^[0-9]+$ ]] ||
  { echo 'BLOCKED: invalid database metadata.' >&2; exit 2; }
[[ "$target_tables" == 0 && "$target_views" == 0 && "$target_bytes" -lt 50000000 && "$source_tables" -gt 0 ]] ||
  { echo 'BLOCKED: Aiven must contain no user tables/views and use less than 50 MB, while Neon must contain application tables.' >&2; exit 2; }
# This source size check is NOT a disk/WAL headroom guarantee. Review the
# Aiven host disk usage metric, index and WAL overhead before approving a copy.
[[ "$source_bytes" -le 700000000 ]] ||
  { echo 'BLOCKED: source size exceeds conservative free-tier migration limit.' >&2; exit 2; }
extension_deps="$(sql DR_SOURCE_DATABASE_URL "SELECT count(*) FROM pg_depend d JOIN pg_extension e ON e.oid=d.refobjid WHERE e.extname='pg_session_jwt' AND d.deptype='n'")"
[[ "$extension_deps" == 0 ]] ||
  { echo 'BLOCKED: source objects depend on an unsupported extension.' >&2; exit 2; }
echo "PREFLIGHT OK: source tables=$source_tables, source bytes=$source_bytes; target is empty."
echo 'Creating one temporary compressed snapshot; removing only the redundant public-schema CREATE entry.'
# Use a private local archive (~17 MiB in the offline trial), allowing pg_restore
# to validate and filter the TOC before modifying the Aiven destination.
umask 077
workdir="$(mktemp -d)"
cleanup() { rm -rf -- "$workdir"; }
trap cleanup EXIT

PGCONNECT_TIMEOUT=12 pg_dump --dbname="$DR_SOURCE_DATABASE_URL" \
  --schema=public --format=custom --compress=6 --no-owner --no-acl \
  --exclude-extension=pg_session_jwt --exclude-extension=pg_stat_statements \
  --file="$workdir/snapshot.dump"
pg_restore --list "$workdir/snapshot.dump" > "$workdir/snapshot.toc"
# Aiven's default database already has an empty public schema. Do not DROP it.
# Remove precisely the archive TOC's SCHEMA - public entry, leaving tables,
# sequences, functions, views, indexes and all other entries untouched.
awk '!/^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public /' "$workdir/snapshot.toc" > "$workdir/restore.toc"
grep -Eq '^[0-9]+; [0-9]+ [0-9]+ TABLE public ' "$workdir/restore.toc" || {
  echo 'BLOCKED: snapshot has no application tables.' >&2; exit 2;
}
if cmp -s "$workdir/snapshot.toc" "$workdir/restore.toc"; then
  echo 'BLOCKED: expected public schema creation entry not found; review archive TOC.' >&2
  exit 2
fi

# The preflight checked destination emptiness, but verify it AGAIN immediately
# before write. This is not a cross-process exclusive lock; do not run
# competing restores or schema migrations.
target_tables_now="$(sql DR_TARGET_DATABASE_URL "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')")"
target_views_now="$(sql DR_TARGET_DATABASE_URL "SELECT count(*) FROM pg_views WHERE schemaname NOT IN ('pg_catalog','information_schema')")"
[[ "$target_tables_now" == 0 && "$target_views_now" == 0 ]] || {
  echo 'BLOCKED: destination is no longer empty.' >&2; exit 2;
}

echo 'Restoring into Aiven in a single transaction; no schema drops or production configuration changes.'
PGCONNECT_TIMEOUT=12 pg_restore --dbname="$DR_TARGET_DATABASE_URL" \
  --use-list="$workdir/restore.toc" --no-owner --no-acl \
  --exit-on-error --single-transaction "$workdir/snapshot.dump"

restored_tables="$(sql DR_TARGET_DATABASE_URL "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
[[ "$restored_tables" == "$source_tables" ]] ||
  { echo 'FAIL: restored public table count mismatch.' >&2; exit 3; }

# Count-table enumeration must itself succeed. Process substitution hides query
# failures, so use a checked command substitution before iterating.
tables_to_check="$(sql DR_SOURCE_DATABASE_URL "SELECT format('%I.%I',schemaname,tablename) FROM pg_tables WHERE schemaname='public' ORDER BY tablename")"
[[ -n "$tables_to_check" ]] || { echo 'FAIL: could not enumerate source tables.' >&2; exit 3; }
mismatches=0
checked=0
while IFS= read -r table; do
  [[ -n "$table" ]] || continue
  before="$(sql DR_SOURCE_DATABASE_URL "SELECT count(*) FROM $table")"
  after="$(sql DR_TARGET_DATABASE_URL "SELECT count(*) FROM $table")"
  checked=$((checked+1))
  if [[ "$before" != "$after" ]]; then
    mismatches=$((mismatches+1))
    echo "ROW COUNT MISMATCH: $table" >&2
  fi
done <<< "$tables_to_check"
[[ "$checked" == "$source_tables" ]] ||
  { echo "FAIL: checked table count differs from source table count." >&2; exit 3; }
[[ "$mismatches" == 0 ]] ||
  { echo "FAIL: $mismatches table counts do not match." >&2; exit 3; }

echo "SNAPSHOT COPIED: $restored_tables public tables; counts matched."
echo 'PRODUCTION UNCHANGED. This is a point-in-time copy, NOT live replication or approved cutover.'
