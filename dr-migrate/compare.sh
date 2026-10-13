#!/usr/bin/env bash
set -Eeuo pipefail
: "${DR_SOURCE_DATABASE_URL:?}"
: "${DR_TARGET_DATABASE_URL:?}"
echo "DR CHECK: comparing all public table counts, source vs Neon."
psql "${DR_SOURCE_DATABASE_URL}" -XAtqc "SELECT format('%I.%I',schemaname,tablename) FROM pg_tables WHERE schemaname='public' ORDER BY tablename" > /tmp/dr_tables
mismatches=0
while IFS= read -r table; do
  a=$(psql "${DR_SOURCE_DATABASE_URL}" -XAtqc "SELECT count(*) FROM ${table}")
  b=$(psql "${DR_TARGET_DATABASE_URL}" -XAtqc "SELECT count(*) FROM ${table}" 2>/dev/null || echo "MISSING")
  if [[ "$a" != "$b" ]]; then echo "DR DIFFERENCE table=${table} railway=${a} neon=${b}"; mismatches=$((mismatches+1)); fi
done </tmp/dr_tables
echo "DR CHECK COMPLETE: mismatched_tables=${mismatches}."
[[ "$mismatches" == 0 ]] || exit 2
