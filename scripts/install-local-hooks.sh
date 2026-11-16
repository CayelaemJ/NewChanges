#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
HOOK_DIR="$(git rev-parse --git-path hooks)"
mkdir -p "$HOOK_DIR"
if [ -e "$HOOK_DIR/pre-push" ]; then
  echo "Existing pre-push hook at $HOOK_DIR/pre-push; refusing to overwrite it." >&2
  exit 1
fi
cp .githooks/pre-push "$HOOK_DIR/pre-push"
chmod +x "$HOOK_DIR/pre-push"
echo "Installed NewChanges pre-push hook: $HOOK_DIR/pre-push"
echo "Use bash scripts/push-verified.sh for additional post-push checks."
