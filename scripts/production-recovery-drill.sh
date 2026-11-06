#!/usr/bin/env bash
# Read-only Neon/Aiven backups followed by disconnected local restores.
# NEVER executes a live delta, changes service settings, or enables writers.
set -Eeuo pipefail
umask 077
cd "$(dirname "$0")/.."
for name in DR_SOURCE_DATABASE_URL DR_TARGET_DATABASE_URL AGE_IDENTITY_FILE AGE_RECIPIENT NEWCHANGES_BACKUP_DIR; do
  if [[ -z "${!name:-}" ]]; then
    echo "BLOCKED: Required private environment setting missing: $name" >&2
    exit 2
  fi
done
for executable in age age-keygen docker pg_dump pg_restore node sha256sum; do
  command -v "$executable" >/dev/null || { echo "BLOCKED: required binary missing: $executable" >&2; exit 2; }
done
if [[ ! -f "$AGE_IDENTITY_FILE" || ! "$NEWCHANGES_BACKUP_DIR" = /* ]]; then
  echo "BLOCKED: private age identity must exist and backup directory must be absolute" >&2; exit 2
fi
actual_recipient="$(age-keygen -y "$AGE_IDENTITY_FILE")"
if [[ "$actual_recipient" != "$AGE_RECIPIENT" ]]; then
  echo "BLOCKED: AGE_RECIPIENT does not match the available private recovery identity" >&2; exit 2
fi
if [[ "$NEWCHANGES_BACKUP_DIR" = *"/NewChanges-free-edge"* ]]; then
  echo "BLOCKED: never write production backups into the repository" >&2; exit 2
fi
mkdir -p "$NEWCHANGES_BACKUP_DIR"
chmod 700 "$NEWCHANGES_BACKUP_DIR"
# Never send any actual database URL to diagnostics or a command-line argument.
node scripts/production-encrypted-backup.mjs source --preflight
node scripts/production-encrypted-backup.mjs target --preflight
bash -n scripts/verify-encrypted-backup-restore.sh
echo "BACKUP START: read-only encrypted copies of source and target. No live writes."
for side in source target; do
  if [[ "$side" == source ]]; then
    echo "SOURCE PORTABLE DRILL: restoring public application schema only, not Neon-managed extensions or other schemas."
    output="$(node scripts/production-encrypted-backup.mjs source --portable-backup)"
  else
    output="$(node scripts/production-encrypted-backup.mjs target --backup)"
  fi
  printf '%s\n' "$output"
  archive="$(printf '%s\n' "$output" | sed -n 's/^LOCAL PATH: //p')"
  if [[ -z "$archive" || ! -f "$archive" ]]; then
    echo "BLOCKED: no encrypted backup artifact confirmed for $side" >&2; exit 2
  fi
  sha256sum "$archive"
  AGE_IDENTITY_FILE="$AGE_IDENTITY_FILE" bash scripts/verify-encrypted-backup-restore.sh "$archive"
  echo "PASS: $side recovery archive restored locally. Archive remains encrypted in $NEWCHANGES_BACKUP_DIR."
done
echo "LOCAL PORTABLE APPLICATION RESTORE DRILL COMPLETE: Neon public schema and full Aiven snapshots restored offline."
echo "Neon FULL disaster recovery remains separately dependent on pg_session_jwt extension availability; the initial full archive is preserved."
echo "Copies are NOT offsite until independently and securely duplicated outside this host."
echo "NOT CUTOVER AUTHORIZATION: legacy writers, final sync, MFA, Cloudflare and Render DB secrets unchanged."
