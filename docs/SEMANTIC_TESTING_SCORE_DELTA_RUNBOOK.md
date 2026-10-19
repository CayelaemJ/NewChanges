# Isolated Neon synthetic score-delta rehearsal

## Scope and safety
- Neon project: `newchanges-primary-pg18` (project `wild-base-70222190`)
- Branch: `newchanges-testing-rehearsal-20261017` (`br-soft-mouse-b9rnii5t`), **NOT** `main`.
- Database: `newchanges_testing_20261017` ONLY. The fixture and both runners hard-reject any other database name.
- Synthetic employer: `__synthetic_semantic_e2e_20261019__`. No person or company data.
- Never point these commands at Railway Production, the default Neon branch, or a deployed Render/Railway service.
- Existing fixture source generation is deliberately marked `validation.testingOnly=true`, `sourceMode=SYNTHETIC`. Its cursors are synthetic test markers; they are **not** evidence of actual external source reconciliation.

## Verified on 19 October
- The fixture was inserted transactionally into the isolated database and read back.
- One synthetic employer, one employee, one platform user, one journey, debt and insurance records were observed, with exactly ten source cursors.
- Synthetic baseline journey saving = 10,000 cents; achievable cashflow target = R500.
- The fixture's ScoreSnapshot table was still empty before the Node test runner had been executed.
- Latest CircleCI checks must be re-evaluated for the newest PR commit.

## Run when an authorized Testing Node runner has database access
Do not print or paste connection URLs into logs.

1. Obtain the Neon connection URL for the **Testing branch, Testing database**, with `sslmode=require`, through approved environment secrets.
2. Explicitly disable `ENABLE_SEMANTIC_SHADOW_WORKER` and `ENABLE_SEMANTIC_OBJECT_PUBLISH` for this isolated runner.
3. Set `SEMANTIC_SYNTHETIC_E2E_APPROVED=YES_TEST_ONLY`.
4. Run `npm run semantic:e2e:preflight` and `npm run semantic:e2e:score-delta`.
5. Check that the output reports `scoreChanged:true` and numeric `baselineScore` / `changedScore`, then `Synthetic Testing journey and baseline score restored`. On an exception, inspect the synthetic row before retrying; do not overwrite other records.

The harness deliberately:
- invokes real `snapshotEmployer()` scoring with the persisted canonical rows;
- changes only the namespaced synthetic journey's `monthlySavingCents` (10,000 → 30,000);
- checks that `ScoreSnapshot` and `getDashboardPayload()` agree on the changed score;
- restores the synthetic journey and recalculates the baseline in `finally`;
- does **not** mark a semantic refresh job as published or create a durable object without a real object store.

## Gates still outstanding
This is database-backed **source-row → score/read-model** verification, not a full live source → browser rehearsal. Still required: external source extraction across all ten feeds, queue enqueue/claim/retry, authenticated durable S3-compatible PUT/GET SHA-256, manifest CAS publication, canary/dashboard UI refresh and measured 30–60 second update under load. Production flag activation remains prohibited until explicitly approved.
