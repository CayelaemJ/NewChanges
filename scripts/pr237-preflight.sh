#!/usr/bin/env bash
# Read-only local PR #237 code validation: no AWS access, no CDC activation.
set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "[PR237] Checking local toolchain..."
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Node.js 24 and npm are required." >&2
  exit 2
fi
major="$(node -p 'Number(process.versions.node.split(".")[0])')"
if [[ "$major" -ne 24 ]]; then
  echo "PR #237 uses Node.js 24; found $(node --version). Run: nvm install 24 && nvm use 24" >&2
  exit 2
fi

if [[ ! -x node_modules/.bin/tsx ]] || [[ ! -x node_modules/.bin/tsc ]]; then
  echo "[PR237] Installing locked backend test dependencies..."
  npm ci --no-audit --no-fund
fi

echo "[PR237] Testing reader, publication and source control centre (40 Node tests)..."
npm run check:cdc-dashboard

echo "[PR237] Type-checking backend..."
npx --no-install tsc --noEmit

if [[ ! -d frontend/node_modules ]]; then
  echo "[PR237] Installing locked frontend dependencies..."
  npm ci --prefix frontend --no-audit --no-fund
fi

echo "[PR237] Type-checking React frontend..."
npm run check:frontend:typecheck

echo "[PR237] Building frontend bundle..."
npm run build --prefix frontend

if [[ "${1:-}" == "--full" ]]; then
  echo "[PR237] Running disposable MySQL CDC integration suite..."
  bash simulation/ops/ci-docker.sh
fi

echo "[PR237] Code checks PASS at $(git rev-parse --short HEAD)."
echo "[PR237] This does NOT mean live RDS CDC retention, grants, snapshot, or multi-source activation are approved."
