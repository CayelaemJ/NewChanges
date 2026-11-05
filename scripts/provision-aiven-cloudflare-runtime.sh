#!/usr/bin/env bash
# One-time Aiven runtime login provisioning. Password never printed or committed.
set -Eeuo pipefail
umask 077
: "${DR_TARGET_DATABASE_URL:?Missing DR_TARGET_DATABASE_URL}"
node <<'NODE'
const u = new URL(process.env.DR_TARGET_DATABASE_URL);
if (!['postgres:', 'postgresql:'].includes(u.protocol) ||
    u.hostname !== 'the-fixer-postgres-cay-bed7.b.aivencloud.com' ||
    u.port !== '26029' || u.pathname !== '/defaultdb') {
  console.error('BLOCKED: target is not the approved Aiven database.');
  process.exit(2);
}
NODE
if ! command -v psql >/dev/null; then echo 'BLOCKED: PostgreSQL client required.' >&2; exit 2; fi
exists="$(psql "$DR_TARGET_DATABASE_URL" -X -w -A -t -v ON_ERROR_STOP=1 -c "SELECT count(*) FROM pg_roles WHERE rolname='newchanges_app_runtime'")"
if [[ "$exists" != "0" ]]; then echo 'BLOCKED: runtime role exists; inspect it instead of resetting credentials.' >&2; exit 2; fi
read -r -s -p 'Choose a UNIQUE runtime database password of at least 32 characters: ' AV_APP_ROLE_PASSWORD
printf '\n'
if [[ ${#AV_APP_ROLE_PASSWORD} -lt 32 ]]; then echo 'BLOCKED: password too short.' >&2; exit 2; fi
export AV_APP_ROLE_PASSWORD
# Use psql \getenv, not -v password=... CLI arguments.
psql "$DR_TARGET_DATABASE_URL" -X -w -v ON_ERROR_STOP=1 -q <<'SQL'
\getenv app_password AV_APP_ROLE_PASSWORD
SELECT format('CREATE ROLE newchanges_app_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'newchanges_app_runtime') \gexec
GRANT CONNECT ON DATABASE defaultdb TO newchanges_app_runtime;
GRANT USAGE ON SCHEMA public TO newchanges_app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO newchanges_app_runtime;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO newchanges_app_runtime;
SQL
unset AV_APP_ROLE_PASSWORD
echo 'Runtime role created. Verify effective permissions before using it in production.'
