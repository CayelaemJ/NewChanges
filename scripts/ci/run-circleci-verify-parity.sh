#!/bin/sh
# Individual checks present in the original CircleCI "verify" job but not in the base Docker suite.
# Run only inside the disposable Docker Compose environment.
set -eu
[ "${CI:-}" = true ] || { echo "CI fixture required" >&2; exit 2; }
[ "${DATABASE_URL:-}" = 'postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci' ] || { echo "Refusing non-fixture database" >&2; exit 2; }
[ "${ENABLE_SEMANTIC_OBJECT_PUBLISH:-}" = false ] || exit 2
[ "${ENABLE_SEMANTIC_SHADOW_WORKER:-}" = false ] || exit 2
run() { echo ">>> $*"; "$@"; echo "<<< PASS $*"; }
run node scripts/production-boundary-check.mjs
run node scripts/portfolio-loading-check.mjs
run node scripts/admin-refresh-clarity-check.mjs
run node scripts/dataset-replacement-preview-check.mjs
run node scripts/source-config-preservation-regression-check.mjs
run node scripts/replacement-dependency-audit-check.mjs
run node scripts/semantic-queue-batch-check.mjs
for check in check:contract check:neon-egress check:admin-ui check:ui check:imports check:scheduling check:daily-refresh check:enterprise-operations check:unified-data-ingestion check:enterprise-analytics-phase-2 check:react check:role-perspective test:score check:brand check:mlops check:mlops-data-quality check:south-africa-compliance check:period-comparison; do
  run npm run "$check"
done
for file in bounded-source-feed.test.ts interrupted-sync-recovery.test.ts dataset-replacement-approval.test.ts dataset-replacement-feed-budget.test.ts dataset-replacement-staging.test.ts dataset-replacement-staging-plan.test.ts dataset-replacement-object-integrity.test.ts dataset-replacement-manifest-review.test.ts dataset-replacement-storage-review.test.ts dataset-replacement-playground-store.test.ts dataset-replacement-transfer-budget.test.ts dataset-replacement-chronological-consumer.test.ts dataset-replacement-keyset-sql.test.ts canonical-schema-mapping.test.ts canonical-schema-discovery.test.ts canonical-mapped-keyset-sql.test.ts canonical-mapped-staging-runner.test.ts playground-mapped-staging-store.test.ts mapped-staging-recovery.test.ts playground-mysql-snapshot.test.ts ten-canonical-mapped-playground.test.ts canonical-mapped-row-validation.test.ts playground-mapped-import-rehearsal.test.ts isolated-cloud-page-sink.test.ts bounded-cloud-stage-http.test.ts fenced-staging-ledger.test.ts fenced-cloud-receipt-recorder.test.ts ten-feed-cutover-gate.test.ts testing-s3-smoke-guard.test.ts testing-cloud-mapped-rehearsal.test.ts mapped-staging-evidence.test.ts near-realtime-source-watch.test.ts source-watch-health.test.ts source-watermark-drift.test.ts sync-alert-policy.test.ts render-railway-pg-readonly-probe.test.ts approved-mapped-rehearsal-cli.test.ts cloud-receipt-fencing-integration.test.ts playground-mysql-rehearsal-config.test.ts bounded-dimension-cache.test.ts monitoring-query-regression.test.ts semantic-shadow-provenance.test.ts; do
  if [ "$file" = bounded-source-feed.test.ts ]; then
    run node --max-old-space-size=192 --import tsx "tests/$file"
  elif [ "$file" = interrupted-sync-recovery.test.ts ]; then
    run node --import tsx "tests/$file"
  else
    run ./node_modules/.bin/tsx "tests/$file"
  fi
done
echo "CircleCI verify parity checks completed."
