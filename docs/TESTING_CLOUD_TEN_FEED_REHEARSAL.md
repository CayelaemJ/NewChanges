# Cloud-backed ten-feed rehearsal — Railway Testing ONLY

This command composes the source-agnostic ten-feed MySQL compiler,
repeatable-read read-only MySQL snapshot, strict canonical validation,
signed S3-compatible PUT+GET SHA-256 readback, and PostgreSQL fenced
checkpoint receipts on the dedicated Testing Neon database.

It does **not** ingest into canonical Neon history, publish a semantic
generation, change a live source, or write to Production.

## Operator prerequisites

1. Railway environment **Testing** with a functioning isolated NewChanges
   service; use a verified `DATABASE_URL` for a database called
   `newchanges_testing_*` hosted on Neon, never the Production DB.
2. An approved ten-feed JSON mapping whose source business semantics, natural
   keys and timestamps have been reviewed. Never embed passwords in the file.
3. A restricted non-root MySQL account on the actual source with
   certificate-verified TLS and permission to SELECT approved reporting tables
   and metadata only. Do not weaken TLS or use root to satisfy the canary.
4. A dedicated Testing S3 bucket with `SEMANTIC_S3_ENDPOINT`,
   `SEMANTIC_S3_BUCKET`, `SEMANTIC_S3_REGION`, the server-side access and
   secret keys, and `SEMANTIC_S3_URL_STYLE`. Credentials must stay in Railway
   reference variables; never log signed URLs or source data.
5. A **Testing-only** fenced checkpoint table installed in the separately
   isolated `staging_rehearsal` schema, as tested on the Testing Neon branch.
6. Explicit environment approvals:
   `RAILWAY_ENVIRONMENT_NAME=Testing`,
   `PLAYGROUND_MAPPED_SOURCE_APPROVED=yes`,
   `TESTING_CLOUD_TEN_FEED_APPROVED=YES_I_APPROVE`,
   a UTC `PLAYGROUND_SOURCE_WATERMARK`, and the bounded
   `PLAYGROUND_{PAGE_SIZE,ROWS_PER_FEED,BYTES_PER_FEED,PAGES_PER_FEED}`
   variables. `ENABLE_GOVERNED_SOURCE_CUTOVER=false` and
   `ENABLE_SEMANTIC_SHADOW_ENQUEUE=false`.

Run from the application working directory on the authorized Testing worker:

```bash
node scripts/run-testing-cloud-rehearsal.mjs /path/to/approved-mapping.json
```

The runner strictly limits aggregate source bytes (64 MiB cap),
bounds page objects to 2 MiB each, reserves PUT+GET transfer costs before
network requests and requires one immutable source snapshot across ten feeds.
The sequence fails closed if an earlier feed fails; the write-side lease uses
a current generation, owner, version, expiry and monotonic fencing token.
Staged object receipts are issued **only after verifying stored bytes**.

A new MySQL transaction after disconnect is **not** the prior consistent
snapshot: do not resume the old generation with a new source transaction
without CDC/immutable source replay approval. The ledger rejects unrelated
snapshot identities. Orphan content-addressed pages from failed CAS require
separately designed and bounded cleanup.

### Evidence still needed

This new command has **not yet executed against actual MySQL and S3**.
Railway write operations began returning `required role (member)` on
17 October, leaving the Testing source update staged and the initial S3
smoke probe unexecuted. Source table mappings and restricted TLS MySQL
credentials are not yet approved. Green CI proves only the integration
contracts and fail-closed guards, not source-to-Neon production readiness.

Even a successful cloud staging run does not complete Phase 4: transactional
canonical publication, tenant/data reconciliation, semantic dashboard parity,
recovery from a changing real source, monitoring and operator cutover approval
must all pass independently.
