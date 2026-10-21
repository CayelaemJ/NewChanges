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
4. Run `npm run semantic:e2e:preflight`, `npm run semantic:e2e:score-delta` and `npm run semantic:e2e:queue`.
5. Check that the output reports `scoreChanged:true` and numeric `baselineScore` / `changedScore`, then `Synthetic Testing journey and baseline score restored`. On an exception, inspect the synthetic row before retrying; do not overwrite other records.

The harness deliberately:
- invokes real `snapshotEmployer()` scoring with the persisted canonical rows;
- changes only the namespaced synthetic journey's `monthlySavingCents` (10,000 → 30,000);
- checks that `ScoreSnapshot` and `getDashboardPayload()` agree on the changed score;
- restores the synthetic journey and recalculates the baseline in `finally`;
- does **not** mark a semantic refresh job as published or create a durable object without a real object store.

## Scope of the durable queue rehearsal
The queue script uses actual Testing PostgreSQL and Prisma, but **does not** execute the semantic publisher or storage upload. It first refuses an occupied pending/running queue, inserts only a namespaced synthetic job, verifies an idempotent duplicate enqueue, claims with exact `generationId` and `employerId` scope, confirms `COMPLETED`, then deletes only its own synthetic job in `finally`. The standard worker continues to claim globally when no testing scope is supplied.

## Gates still outstanding
This is database-backed **source-row → score/read-model** verification, not a full live source → browser rehearsal. Still required: external source extraction across all ten feeds, queue enqueue/claim/retry, authenticated durable S3-compatible PUT/GET SHA-256, manifest CAS publication, canary/dashboard UI refresh and measured 30–60 second update under load. Production flag activation remains prohibited until explicitly approved.

## Existing CircleCI Node runner — explicit opt-in only
The PR adds an isolated `semantic_testing_score_delta` job with top-level CircleCI pipeline parameter `semantic_testing_e2e` (default `false`). Ordinary PR pushes **never** execute the data-changing test.

To run manually, an authorized CircleCI operator must:
1. Store the **Testing-branch** Neon connection string as masked environment variable `SEMANTIC_TESTING_DATABASE_URL` in a restricted CircleCI context named `newchanges-neon-testing` (not `DATABASE_URL`). Restrict this context to authorized operators and the feature branch; do not place the Testing credential in project-wide variables. Use `newchanges_testing_20261017`, verified Neon host, `sslmode=require`. Do **not** paste credentials into a PR, chat, pipeline parameter, or job output.
2. Trigger a CircleCI pipeline on the feature branch with boolean parameter `semantic_testing_e2e=true`.
3. Confirm the `semantic_testing_score_delta` job reports a changed numerical score and restoration, followed by a scoped durable queue enqueue/dedupe/claim/complete result and removal of its own test job. The job requires the dedicated secret; it overrides inherited `DATABASE_URL`, refuses the Production Railway environment and sets semantic publication/worker switches off.
4. Review the normal `verify`, source-quality, browser and security checks separately.

This does not deploy the app, run a background worker, or publish object storage manifests. It consumes existing CircleCI runner minutes; verify free-plan limits with the organization before starting. The restricted CircleCI context has not been verified or configured through the available tools. No CircleCI credentials or Testing secret are accessible here, so the pipeline cannot be triggered from this session.

## Publication-ordering and bounded-canary safeguards
- A new `SemanticSnapshotManifest` may not replace a newer published source watermark. The monotonic check occurs within the pointer's serializable transaction.
- Canary reads stream only the manifest-recorded object size; oversized or corrupted content is rejected before serving.
- Tests run in normal CircleCI verification without requiring a database or external object store.

## Metadata publisher + rollback rehearsal (manual CircleCI)
The opt-in Testing job additionally executes `npm run semantic:e2e:publication-metadata`. Its guarded code uses the application's real Prisma publisher/rollback methods on only the seeded synthetic employer, creating three uniquely identified **synthetic metadata-only manifests** with calculated fixture hashes. It verifies digest/byte mismatch rejection, optimistic compare-and-swap, increasing source-watermark enforcement, audited rollback, and stale rollback rejection. Its `finally` cleanup deletes only this invocation's synthetic publication metadata.

**This rehearsal deliberately does not store object bytes in S3 or perform signed PUT/GET.** A green result must not be used as evidence that real durable storage or dashboard serving works.

The workflow is restricted to feature branch `fix/semantic-refresh-period-validation-20261019`, with CircleCI context `newchanges-neon-testing` and boolean pipeline parameter `semantic_testing_e2e=true` (default false). An authorized CircleCI operator must confirm that this context actually exists, limit its access to the approved project and feature branch, and install the masked Testing-only `SEMANTIC_TESTING_DATABASE_URL` secret. The current connections cannot inspect CircleCI context settings or trigger the job. Do not use production credentials or enable this job on ordinary PR builds.


## Provider-independent storage-to-publication integration
Normal CircleCI `check:semantic-storage` now includes `tests/semantic-s3-roundtrip.test.ts`. Its offline HTTPS emulator independently reconstructs AWS Signature V4 authorization for signed GET/PUT, checks content SHA-256 on readback, and rejects altered signed query parameters and corrupted response bytes. **No storage account or credentials are required.**

The manual `semantic_testing_e2e=true` workflow also runs `npm run semantic:e2e:storage-publication` after the database-backed scoring, queue and metadata tests. It uses:
- The exact synthetic employer/source generation already seeded in `newchanges_testing_20261017`, checked at runtime.
- Real `stageAndPublishSemanticObject` logic, live isolated Neon metadata transactions, publication pointer swaps, and audited rollback.
- An in-memory fake HTTPS S3 transport that refuses all non-synthetic hosts/paths; it is never allowed to send requests to real storage.
- A deliberate corrupted GET that must fail before a manifest/pointer is created, followed by two readback-verified synthetic publications and rollback.
- Cleanup of the unique synthetic manifests, pointers and audit entries produced by that invocation.

**Boundaries:** This proves code-level cryptographic signing and transport verification in normal CI, and can prove integrated storage verification / Neon publication transactions on a manual Testing run. It does not establish durable third-party bucket storage, browser freshness, automatic SQL-source change detection, 30–60 second update timing, or production readiness. Until the manual workflow is actually run, even the integrated Neon behavior is *unverified*. Never turn this Testing emulator into a production storage provider.


### Presigned object identity guard
Production semantic publication now refuses to upload unless **both** signed S3 URLs address exactly the same immutable `semantic/<generation>/<employer>/<period>/<version>.json` key recorded in the manifest. It also requires HTTPS and Signature V4 metadata. This avoids treating a successful digest verification for a different object as proof that the manifest's referenced key is durable. The ordinary, offline storage test exercises this guard with valid signatures, mismatched keys, missing signatures, insecure protocols and encoded key names.

## Continuous isolated source-to-canary rehearsal (manual, not executed)
The `semantic_testing_e2e=true` CircleCI job now ends with `npm run semantic:e2e:canonical-to-canary`. With the restricted Neon Testing secret, it takes the synthetic employer's real canonical rows through `snapshotEmployer`, persists the baseline score, publishes a read-back-verified **in-memory S3 emulation**, changes the namespaced journey's savings value, recalculates, publishes the changed score, checks the real Neon publication audit cursor and the canary's decoded wellness score, rolls back the pointer, and verifies the original score is served again. Its `finally` restores the synthetic source row, rebuilds the baseline and cleans up only its own manifests and pointers. This is an application-service integration test against isolated Neon, **not** a deployed browser/API or durable object-store test. No production flags are enabled.

## Real external storage verification, strictly read-only
When an already-existing object is available **in an approved, separate Testing bucket**, `npm run semantic:e2e:real-storage-read` can prove its durable-byte availability at that moment without an upload, delete, service provisioning or database write. An authorized operator must supply the credentials via a secured Node runner and the following Testing-only environment variables, without logging them:

- `SEMANTIC_STORAGE_READ_APPROVED=YES_TESTING_READ_ONLY`
- `SEMANTIC_S3_ENDPOINT`, `SEMANTIC_S3_BUCKET`, `SEMANTIC_S3_REGION`, `SEMANTIC_S3_ACCESS_KEY_ID`, `SEMANTIC_S3_SECRET_ACCESS_KEY` (and addressing style if required)
- `SEMANTIC_VERIFY_ALLOWED_HOST` — the **exact** public DNS hostname of the approved Testing storage endpoint
- `SEMANTIC_VERIFY_OBJECT_KEY` — an existing object under `semantic/__synthetic_semantic_generation_20261019__/__synthetic_semantic_e2e_20261019__/`
- `SEMANTIC_VERIFY_SHA256` and `SEMANTIC_VERIFY_BYTES` — independently recorded expected digest and byte size

The command refuses non-Testing-named buckets, other employers/generations, unapproved endpoints, invalid hashes or oversized objects before making a network request. It performs a single bounded signed `GET` and independent SHA-256/size comparison, then prints **only** proof metadata. No presigned URL, object contents or secret is emitted. Its validation and tamper cases run offline in ordinary CircleCI; the actual external GET has **not** been executed and requires a preexisting object and credentials.

S3 request charges, network costs and existing-provider billing depend on the provider; this does not provision or buy any infrastructure. Do not use an unpaid Railway account or production object to satisfy this test. A real Testing publication still needs both an independently controlled source-to-object upload and subsequent canary read, plus an authenticated HTTP/browser acceptance run.
