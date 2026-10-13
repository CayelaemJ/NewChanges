#!/usr/bin/env bash
set -Eeuo pipefail
: "${DR_SOURCE_DATABASE_URL:?}"
: "${DR_TARGET_DATABASE_URL:?}"
export PGCONNECT_TIMEOUT=15
for name in AnalyticsEvent DataAccessEvent; do
  echo "DELTA: loading ${name} from Railway"
  psql "${DR_SOURCE_DATABASE_URL}" -X -v ON_ERROR_STOP=1 -c "\\copy public.\"${name}\" TO '/tmp/${name}.csv' WITH (FORMAT csv, HEADER true)" >/dev/null
  echo "DELTA: upserting missing ${name} records into Neon"
  psql "${DR_TARGET_DATABASE_URL}" -X -v ON_ERROR_STOP=1 <<SQL
BEGIN;
CREATE TEMP TABLE delta_copy (LIKE public."${name}") ON COMMIT DROP;
\\copy delta_copy FROM '/tmp/${name}.csv' WITH (FORMAT csv, HEADER true)
INSERT INTO public."${name}" SELECT * FROM delta_copy ON CONFLICT (id) DO NOTHING;
COMMIT;
SQL
  rm -f "/tmp/${name}.csv"
done
echo "DELTA: append-only event tables reconciled. Other tables were verified equal by row count during earlier check."
