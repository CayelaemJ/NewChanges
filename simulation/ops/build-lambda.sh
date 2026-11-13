#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")/.."
mkdir -p out
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT
python3 -m pip install --disable-pip-version-check --target "$build" -r requirements.txt
cp -r runtime "$build/runtime"
if [[ ! -f ops/rds-global-bundle.pem ]]; then
  echo 'Missing official Amazon RDS eu-north-1 CA bundle at ops/rds-global-bundle.pem' >&2
  exit 1
fi
cp ops/rds-global-bundle.pem "$build/rds-global-bundle.pem"
(cd "$build" && zip -qr "$OLDPWD/out/lambda.zip" .)
echo 'Lambda package built locally; nothing deployed.'
