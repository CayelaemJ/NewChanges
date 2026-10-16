# Dataset replacement: remaining production gates

This PR provides an isolated **local filesystem object-store adapter** for
Playground/CI and verifies ten source-scoped objects by reading their bytes.
It is intentionally **not a production S3/R2/Neon-storage adapter** and
does not extract, mutate, publish, delete, switch sources, or enable workers.

## Required before deployment or production replacement

1. Implement an authenticated production object-store GET adapter that accepts
   only pre-authorized generation-scoped keys; enforce request timeouts and byte caps.
2. Create a generation-specific ten-feed extraction/storage job using immutable
   keys, source watermarks and trusted per-feed row-count provenance.
3. Exercise the ten-feed readback against real Playground object storage.
4. Rehearse isolated Neon snapshot restore and verify tenant/user/role/permission
   mappings and FK integrity. Record operator-approved recovery evidence.
5. Prove single ingestion owner, complete cursors, scheduled refresh, error
   recovery, and atomic generation publication with a tested rollback.
6. Rehearse Railway/Render consistency without simultaneous writers; verify
   dashboard parity, performance, and object-storage/Neon cost impact.
7. Require release approval and CI/security sign-off. Preserve active production
   source and keep semantic publication disabled until gates pass.

## Isolated test

`npx tsx tests/dataset-replacement-playground-store.test.ts`

Creates only temporary local files; checks ten feed readback, deletion,
corruption, symlink denial, and path traversal. Cleans up after execution.
