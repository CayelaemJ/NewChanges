#!/usr/bin/env bash
# No outside network access; no ports published; no production credentials.
set -Eeuo pipefail

IMAGE="newchanges-free-backend:preflight"
RUN_ID="$$"
NETWORK="fixer-smoke-$RUN_ID"
DB="fixer-smoke-db-$RUN_ID"
APP="fixer-smoke-app-$RUN_ID"
PASS="local-synthetic-only"
cleanup() {
  docker rm -f "$APP" "$DB" >/dev/null 2>&1 || true
  docker network rm "$NETWORK" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker image inspect "$IMAGE" >/dev/null
docker image inspect postgres:18-alpine >/dev/null
docker network create --internal "$NETWORK" >/dev/null
docker run --detach --rm --name "$DB" --network "$NETWORK" \
  --network-alias smoke-db --memory 512m \
  --env POSTGRES_USER=smoke \
  --env POSTGRES_PASSWORD="$PASS" \
  --env POSTGRES_DB=synthetic \
  postgres:18-alpine >/dev/null

echo "Checking isolated PostgreSQL startup..."
db_ready=false
for i in $(seq 1 45); do
  if docker exec "$DB" pg_isready -q -U smoke -d synthetic >/dev/null 2>&1; then
    db_ready=true; break
  fi
  sleep 1
done
if [ "$db_ready" != true ]; then
  echo "FAIL: synthetic PostgreSQL did not become ready" >&2
  docker logs --tail 30 "$DB" >&2 || true
  exit 1
fi

docker run --detach --rm --name "$APP" --network "$NETWORK" \
  --memory 768m \
  --env NODE_ENV=production \
  --env PORT=3000 \
  --env DATABASE_URL="postgresql://smoke:$PASS@smoke-db:5432/synthetic?connection_limit=2" \
  --env STANDBY_MODE=true \
  --env TRAFFIC_SAVER_MODE=true \
  --env ENABLE_AUTHORITATIVE_INCREMENTAL_SCHEDULER=false \
  --env NEWCHANGES_EDGE_ORIGIN_GUARD_ENABLED=true \
  --env NEWCHANGES_EDGE_ORIGIN_SHARED_SECRET=synthetic-local-origin-token-of-40-chars \
  "$IMAGE" >/dev/null

echo "Checking Fastify health, PostgreSQL readiness, and protected origin..."
passed=false
for i in $(seq 1 45); do
  if ! docker inspect "$APP" >/dev/null 2>&1; then break; fi
  if docker exec "$APP" node -e '
    (async () => {
      const base = "http://127.0.0.1:3000";
      const [health, ready, direct, proxied] = await Promise.all([
        fetch(base + "/health"),
        fetch(base + "/ready"),
        fetch(base + "/version"),
        fetch(base + "/version", {headers:{
          "X-NewChanges-Edge-Token":"synthetic-local-origin-token-of-40-chars"
        }})
      ]);
      if (health.status !== 200 || ready.status !== 200 ||
          direct.status !== 403 || proxied.status !== 200) process.exit(1);
      const body = await ready.json();
      if (body.database !== "reachable") process.exit(1);
      console.log("PASS: /health=200 /ready=200 /version-direct=403 /version-edge=200");
    })().catch(() => process.exit(1));
  ' ; then passed=true; break; fi
  sleep 1
done
if [ "$passed" != true ]; then
  echo "FAIL: isolated application runtime or origin protection" >&2
  docker logs --tail 80 "$APP" >&2 || true
  exit 1
fi
echo "PASS: offline runtime smoke test; auto-cleanup on exit"
