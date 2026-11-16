#!/usr/bin/env bash
# This wrapper adds after-push verification; Git has no native post-push hook.
# Usage: bash scripts/push-verified.sh [git push arguments]
set -Eeuo pipefail
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"
git push "$@"
echo "Push succeeded. Starting additional local post-push verification."
# Do not use remote services or credentials for the local regression suite.
unset DATABASE_URL DIRECT_URL SHADOW_DATABASE_URL
unset NEON_DATABASE_URL SEMANTIC_TESTING_DATABASE_URL SEMANTIC_LISTEN_DATABASE_URL
unset RAILWAY_DATABASE_URL RAILWAY_ENVIRONMENT_NAME
export CI=true NODE_ENV=test
npm run check:ui
npm run check:imports
npm run check:scheduling
npm run check:daily-refresh
npm run check:brand
npm run check:accessibility
npm run check:performance
npm run check:security-operations
npm run check:security-governance
npm run check:south-africa-compliance
npm run check:mlops
npm run check:mlops-data-quality
npm run check:react
echo "Post-push verification passed."
