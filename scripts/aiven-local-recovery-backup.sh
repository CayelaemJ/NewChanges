#!/usr/bin/env bash
# Create a durable local Neon PostgreSQL 18 recovery archive, with no cloud snapshots or Aiven writes.
set -Eeuo pipefail
set +x

if [[ "${1:-}" != "--execute" ]]; then
  echo 'NO-OP: provide --execute with DR_LOCAL_BACKUP_APPROVED=YES to create a local recovery archive.'
  exit 0
fi
[[ "${DR_LOCAL_BACKUP_APPROVED:-}" == YES ]] || { echo 'BLOCKED: DR_LOCAL_BACKUP_APPROVED=YES required.' >&2; exit 2; }
: "${DR_SOURCE_DATABASE_URL:?Set Neon source connection in the existing shell}"
for tool in pg_dump pg_restore psql node grep sha256sum stat mkdir mv mktemp; do
  command -v "$tool" >/dev/null || { echo "Missing: $tool" >&2; exit 2; }
done
pg_dump --version | grep -Eq 'PostgreSQL\) 18\.' || { echo 'PostgreSQL 18 pg_dump required.' >&2; exit 2; }
pg_restore --version | grep -Eq 'PostgreSQL\) 18\.' || { echo 'PostgreSQL 18 pg_restore required.' >&2; exit 2; }
source="$(node --input-type=module -e '
  const u = new URL(process.env.DR_SOURCE_DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(u.protocol)) process.exit(2);
  process.stdout.write(u.hostname.toLowerCase() + "|" + u.pathname.slice(1));
')"
[[ "$source" == *.neon.tech\|newchanges ]] || { echo 'BLOCKED: unexpected source identity.' >&2; exit 2; }
source_version="$(PGCONNECT_TIMEOUT=12 psql "$DR_SOURCE_DATABASE_URL" -XAt -v ON_ERROR_STOP=1 -c 'SHOW server_version_num')"
[[ "$source_version" =~ ^18[0-9]+$ ]] || { echo 'BLOCKED: Neon source must be PostgreSQL 18.' >&2; exit 2; }

backup_dir="${DR_LOCAL_BACKUP_DIR:-$HOME/.local/share/the-fixer-recovery}"
[[ "$backup_dir" == /* && "$backup_dir" != "$PWD"* ]] || {
  echo 'BLOCKED: backup directory must be an absolute path outside the repository.' >&2; exit 2;
}
umask 077
mkdir -p -m 700 -- "$backup_dir"
chmod 700 -- "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final="$backup_dir/newchanges-recovery-$timestamp.dump"
[[ ! -e "$final" ]] || { echo 'BLOCKED: archive name already exists; refusing overwrite.' >&2; exit 2; }
temporary="$(mktemp "$backup_dir/.newchanges-recovery-XXXXXXXX.dump")"
cleanup() { rm -f -- "$temporary"; }
trap cleanup EXIT
echo 'Creating local full database recovery archive. Aiven and production settings remain unchanged.'
# Deliberately includes all source schemas; permissions/managed Neon objects
# may prevent a fully portable restoration. No assumed full-recovery guarantee.
PGCONNECT_TIMEOUT=12 pg_dump --dbname="$DR_SOURCE_DATABASE_URL" \
  --format=custom --compress=6 --no-owner --no-acl --file="$temporary"
pg_restore --list "$temporary" > /dev/null
table_count="$(pg_restore --list "$temporary" | grep -Ec '^[0-9]+; [0-9]+ [0-9]+ TABLE public ' || true)"
[[ "$table_count" -eq 57 ]] || {
  echo "FAIL: expected 57 public application tables; archive has $table_count." >&2; exit 3;
}
mv -n -- "$temporary" "$final"
chmod 600 -- "$final"
trap - EXIT
echo "LOCAL BACKUP CREATED: $final"
echo "Archive bytes: $(stat -c %s "$final")"
echo "SHA256: $(sha256sum "$final" | awk '{print $1}')"
echo 'This archive is not an independent verified recovery until restored and tested; protect its contents.'
