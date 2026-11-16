#!/usr/bin/env bash
# Verify the specified Neon backup's public application schema in a disposable PostgreSQL 18 instance.
set -Eeuo pipefail
set +x
if [[ "${1:-}" != "--execute" ]]; then
  echo 'NO-OP: usage: bash scripts/aiven-verify-recovery-backup.sh --execute /absolute/path/to/archive.dump'
  exit 0
fi
backup="${2:-}"
[[ -f "$backup" && "$backup" == /* ]] || { echo 'BLOCKED: provide an existing absolute archive path.' >&2; exit 2; }
for cmd in docker pg_restore sha256sum grep awk mktemp; do
  command -v "$cmd" >/dev/null || { echo "Missing: $cmd" >&2; exit 2; }
done
[[ "$(stat -c %a "$backup")" == 600 ]] || { echo 'BLOCKED: archive should have mode 600.' >&2; exit 2; }
if [[ -n "${DR_BACKUP_EXPECTED_SHA256:-}" ]]; then
  actual="$(sha256sum "$backup" | awk '{print $1}')"
  [[ "$actual" == "$DR_BACKUP_EXPECTED_SHA256" ]] || { echo 'FAIL: backup checksum mismatch.' >&2; exit 3; }
fi
toc="$(mktemp)"
container=''
cleanup() {
  rm -f "$toc"
  [[ -z "$container" ]] || docker rm -f "$container" >/dev/null 2>&1 || true
}
trap cleanup EXIT
pg_restore --list "$backup" > "$toc"
expected="$(grep -Ec '^[0-9]+; [0-9]+ [0-9]+ TABLE public ' "$toc" || true)"
[[ "$expected" == 57 ]] || { echo "FAIL: expected 57 public tables; found $expected." >&2; exit 3; }
# Remove only the pre-existing public schema item, leaving table, sequence, index and data entries intact.
awk '!/^[0-9]+; [0-9]+ [0-9]+ SCHEMA - public /' "$toc" > "$toc.filtered"
mv "$toc.filtered" "$toc"
echo 'Restoring this backup into an ephemeral PostgreSQL 18 container with no network access or published ports.'
container="$(docker run -d --rm --network none -e POSTGRES_HOST_AUTH_METHOD=trust postgres:18-alpine)"
for i in {1..40}; do
  if docker exec "$container" pg_isready -U postgres -d postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U postgres -d postgres >/dev/null
docker cp "$backup" "$container:/tmp/backup.dump"
docker cp "$toc" "$container:/tmp/restore.list"
# Restore only the portable application's public schema/data, excluding Neon auth internals.
# pg_restore -n is applied together with --use-list; only public entries are restored.
docker exec "$container" pg_restore -U postgres -d postgres -n public \
  --use-list=/tmp/restore.list --no-owner --no-acl \
  --exit-on-error --single-transaction /tmp/backup.dump
actual="$(docker exec "$container" psql -U postgres -d postgres -At -c "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
[[ "$actual" == 57 ]] || { echo "FAIL: restored $actual public tables; expected 57." >&2; exit 3; }
echo "PASS: exact backup restored to isolated PG18; public tables=$actual"
echo "Archive checksum: $(sha256sum "$backup" | awk '{print $1}')"
echo 'This confirms portable public restore, not full recovery of Neon-managed auth schemas or external services.'
