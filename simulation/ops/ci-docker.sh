#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
# Test-only random passwords, never persisted or printed; safe on self-hosted runners.
export LOCAL_MYSQL_ROOT_PASSWORD="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
export LOCAL_SIM_WRITER_PASSWORD="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
export LOCAL_SIM_CDC_PASSWORD="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
export LOCAL_SIM_REPL_PASSWORD="$(python3 -c 'import secrets;print(secrets.token_urlsafe(32))')"
project="fixer-sim-test-$$"
trap 'docker compose -p "$project" -f docker-compose.yml down --volumes --remove-orphans >/dev/null 2>&1 || true' EXIT
python3 -m unittest discover -s tests -v
docker compose -p "$project" -f docker-compose.yml up --build --abort-on-container-exit --exit-code-from test test
