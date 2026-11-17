#!/usr/bin/env bash
# Bounded CDC/business activity proof, DISPOSABLE Docker only.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null
command -v python3 >/dev/null
export LOCAL_MYSQL_ROOT_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export LOCAL_SIM_WRITER_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export LOCAL_SIM_CDC_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
export LOCAL_SIM_REPL_PASSWORD="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
project="fixer-business-demo-$$"
trap 'docker compose -p "$project" -f docker-compose.yml -f docker-compose.demo.yml down --volumes --remove-orphans >/dev/null 2>&1 || true' EXIT
docker compose -p "$project" -f docker-compose.yml -f docker-compose.demo.yml up --build --abort-on-container-exit --exit-code-from test test
