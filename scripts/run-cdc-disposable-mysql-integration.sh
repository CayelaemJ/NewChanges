#!/usr/bin/env bash
# Opt-in, single-use local MySQL 8.4 integration. Never contacts AWS.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
command -v docker >/dev/null || { echo "Docker is required" >&2; exit 1; }
command -v node >/dev/null || { echo "Node.js is required" >&2; exit 1; }
command -v npm >/dev/null || { echo "npm is required" >&2; exit 1; }
if [[ "${FIXER_CDC_RUN_DISPOSABLE_MYSQL:-}" != "yes" ]]; then
  echo "Refusing to run. Set FIXER_CDC_RUN_DISPOSABLE_MYSQL=yes for a disposable LOCAL Docker test." >&2
  exit 2
fi
name="fixer-cdc-test-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"
password="local-only-$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')"
cleanup(){ docker rm -f "$name" >/dev/null 2>&1 || true; }
trap cleanup EXIT
mode="${FIXER_CDC_TEST_MODE:-metadata}"
if [[ "$mode" != "metadata" && "$mode" != "binlog" && "$mode" != "binlog-shared" ]]; then
  echo "Invalid disposable test mode" >&2
  exit 2
fi
docker run --rm -d --name "$name" \
  --label fixer.cdc.disposable=true \
  --publish 127.0.0.1::3306 \
  -e "MYSQL_ROOT_PASSWORD=$password" \
  mysql:8.4 --log-bin=mysql-bin --server-id=18182 --binlog-format=ROW --binlog-row-image=FULL >/dev/null
port=""
for attempt in $(seq 1 50); do
  port="$(docker port "$name" 3306/tcp 2>/dev/null | sed -n 's/^127\.0\.0\.1:\([0-9][0-9]*\)$/\1/p' | head -1)"
  if [[ -n "$port" ]] && docker exec "$name" mysqladmin ping -h 127.0.0.1 -uroot "-p$password" --silent >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if [[ -z "$port" ]] || ! docker exec "$name" mysqladmin ping -h 127.0.0.1 -uroot "-p$password" --silent >/dev/null 2>&1; then
  echo "Disposable MySQL failed to become healthy" >&2
  exit 1
fi
if [[ "$mode" == "binlog" || "$mode" == "binlog-shared" ]]; then
  if ! python -c 'import pymysql,pymysqlreplication' >/dev/null 2>&1; then
    echo "Install simulation/requirements.txt into your active Python virtualenv." >&2
    exit 2
  fi
  FIXER_CDC_BINLOG_HANDOFF_MODE="$([[ "$mode" == "binlog-shared" ]] && echo shared || echo sqlite)" \
  FIXER_CDC_DISPOSABLE_MYSQL_TEST=I_ACCEPT_LOCAL_CONTAINER_ONLY \
  FIXER_CDC_TEST_CONTAINER="$name" \
  FIXER_CDC_TEST_HOST=127.0.0.1 \
  FIXER_CDC_TEST_PORT="$port" \
  FIXER_CDC_TEST_PASSWORD="$password" \
    env PYTHONPATH=simulation python -m ops.disposable_mysql_binlog_integration
else
  FIXER_CDC_DISPOSABLE_MYSQL_TEST=I_ACCEPT_LOCAL_CONTAINER_ONLY \
  FIXER_CDC_TEST_CONTAINER="$name" \
  FIXER_CDC_TEST_HOST=127.0.0.1 \
  FIXER_CDC_TEST_PORT="$port" \
  FIXER_CDC_TEST_PASSWORD="$password" \
    node --import tsx scripts/cdc-disposable-mysql-integration.ts
fi
