#!/usr/bin/env bash
set -Eeuo pipefail
export PGCONNECT_TIMEOUT=15
: "${DR_SOURCE_DATABASE_URL:?missing source URL}"
: "${DR_TARGET_DATABASE_URL:?missing target URL}"
if [[ "${DR_SOURCE_DATABASE_URL}" == "${DR_TARGET_DATABASE_URL}" ]]; then echo "ABORT: same source and target"; exit 3; fi
echo "DR: connecting to PostgreSQL source and destination..."
src_version=$(psql "${DR_SOURCE_DATABASE_URL}" -XAtqc "SHOW server_version_num")
dst_version=$(psql "${DR_TARGET_DATABASE_URL}" -XAtqc "SHOW server_version_num")
src_size=$(psql "${DR_SOURCE_DATABASE_URL}" -XAtqc "SELECT pg_database_size(current_database())")
src_user_count=$(psql "${DR_SOURCE_DATABASE_URL}" -XAtqc 'SELECT count(*) FROM public."User"')
src_tables=$(psql "${DR_SOURCE_DATABASE_URL}" -XAtqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
dst_tables=$(psql "${DR_TARGET_DATABASE_URL}" -XAtqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
echo "DR PREFLIGHT: source_major=${src_version:0:2}, target_major=${dst_version:0:2}, source_bytes=${src_size}, source_tables=${src_tables}, source_users=${src_user_count}, destination_tables=${dst_tables}"
[[ "${src_version:0:2}" == "18" && "${dst_version:0:2}" == "18" ]] || { echo "ABORT: expected matching PostgreSQL 18 majors"; exit 3; }
[[ "${dst_tables}" == "0" ]] || { echo "ABORT: target has application tables; refusing overwrite"; exit 3; }
[[ "${src_size}" -lt 850000000 ]] || { echo "ABORT: source too large for 1 GiB free destination with headroom"; exit 3; }
echo "DR: creating compressed point-in-time custom-format backup (temporary job storage only)..."
backup=/tmp/newchanges-snapshot.pgcustom
trap 'rm -f "$backup"' EXIT
pg_dump --dbname="${DR_SOURCE_DATABASE_URL}" --format=custom --compress=6 --no-owner --no-acl --file="$backup"
echo "DR BACKUP: compressed_backup_bytes=$(stat -c %s "$backup")"
pg_restore --list "$backup" >/tmp/newchanges-backup.toc
echo "DR: restoring to verified empty Neon destination..."
pg_restore --dbname="${DR_TARGET_DATABASE_URL}" --no-owner --no-acl --exit-on-error --single-transaction "$backup"
echo "DR: validating source/target table counts..."
dst_user_count=$(psql "${DR_TARGET_DATABASE_URL}" -XAtqc 'SELECT count(*) FROM public."User"')
dst_tables=$(psql "${DR_TARGET_DATABASE_URL}" -XAtqc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")
dst_size=$(psql "${DR_TARGET_DATABASE_URL}" -XAtqc "SELECT pg_database_size(current_database())")
echo "DR RESULT: source_users=${src_user_count} target_users=${dst_user_count} source_tables=${src_tables} target_tables=${dst_tables} target_bytes=${dst_size}"
[[ "${src_user_count}" == "${dst_user_count}" && "${src_tables}" == "${dst_tables}" ]] || { echo "DR FAILURE: validation mismatch"; exit 4; }
echo "DR SNAPSHOT COPY COMPLETE. This was a point-in-time copy, NOT live replication or durable offsite backup. Railway primary unchanged."
