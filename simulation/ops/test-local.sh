#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
python3 -m unittest discover -s tests -v
if ! command -v docker >/dev/null 2>&1; then
  echo 'Docker not available: MySQL integration tests NOT RUN' >&2
  exit 2
fi
if [[ "${RUN_LOCAL_MYSQL_TESTS:-no}" != 'yes' ]]; then
  echo 'RUN_LOCAL_MYSQL_TESTS=yes required for Docker integration tests' >&2
  exit 2
fi
docker compose -f docker-compose.yml up --build --abort-on-container-exit --exit-code-from test test
