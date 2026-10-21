# Semantic source-to-dashboard release gates (19 October 2026)

## Confirmed
- PR #169 contains canonical-period, identity, historical refresh, queue, worker and publication guards.
- CircleCI and Snyk were green on commit 4b1a90a; recheck after subsequent commits.
- Isolated Neon branch: newchanges-testing-rehearsal-20261017, database newchanges_testing_20261017.
- Read-only inspection of isolated database on 19 October returned 0 employers, 0 score snapshots, 0 source generations, 0 jobs, 0 manifests and 0 pointers. Empty state is NOT proof of a successful pipeline.
- Render standby must stay in STANDBY_MODE and Railway Production must remain untouched.

## Before running an actual E2E
1. Use approved synthetic fixtures only; do not copy confidential production people or employment records.
2. Provide an isolated SQL source with an approved ten-feed schema mapping, deterministic initial values and a later update or deletion.
3. Create a validated ACTIVE source generation for that isolated fixture and initialize all ten reconciliation cursors.
4. Run `npm run semantic:e2e:preflight` on a secured Testing runner whose `DATABASE_URL` targets the isolated Neon Testing database; this command only reads counts and refuses non-testing databases.
5. Configure an isolated S3-compatible bucket and authorized worker credentials. Keep the semantic publication/recompute switches off in every production environment.
6. Capture baseline ScoreSnapshot and dashboard API score, perform source change, enqueue and process, verify new ScoreSnapshot and publication pointer; read the object independently and compare scores.
7. Measure source-change detection through browser-visible score update. The 30–60 second target is NOT demonstrated.
8. Exercise 10 feeds, retroactive change, deletion, retry/lease expiry, CAS conflict, read-after-write digest failure and rollback.
9. Only after successful Testing verification, request explicit approval for any deployment/merge/production activation.

## Blockers remaining as at this check
- Isolated Testing DB is empty; no fixture employer, baseline score or active source generation.
- Approved test-source connection and ten-feed mapping are not available to the runner.
- Testing external object-storage connectivity and worker scheduling have not been demonstrated.
- The semantic canary route is feature-gated and is not equivalent to a browser-visible automatic refresh until serving flags and polling are verified.
- No isolated end-to-end database-backed delta/score/manifest/dashboard benchmark has passed.

No extra Railway or GitHub Actions payments are required for this read-only preflight or code-level CI.
