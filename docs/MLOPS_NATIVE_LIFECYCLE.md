# Native MLOps model lifecycle (phase 1 hardening)

The portal's existing MLOps implementation runs inside the Fastify application and uses Prisma and PostgreSQL. No new standalone MLOps hosting subscription is required.

## Implemented in this branch

- Model promotions only accept registered SHADOW versions.
- Rollback restores a previously RETIRED version, and refuses to proceed without a currently ACTIVE version.
- Both paths use an interactive Prisma transaction with a transaction-scoped PostgreSQL advisory lock on the model key.
- A pre-existing multiple-ACTIVE configuration blocks transitions pending reconciliation.
- Old and new versions switch in the same transaction; failure rolls back the whole transition.
- Every successful transition writes a MODEL_PROMOTION or MODEL_ROLLBACK event with previous and new versions.
- The existing admin routes continue to enforce admin privileges and preserve admin action logs.

## API behaviour

- POST /api/admin/mlops/models/:modelKey/:version/promote activates a SHADOW model.
- POST /api/admin/mlops/models/:modelKey/:version/rollback restores the supplied RETIRED model as ACTIVE.
- GET /api/admin/mlops/models lists versions; GET /api/admin/mlops/events provides events.

This change is **not** a complete MLOps orchestration service. Promotion is a registry state transition, not an automatic process restart, deployment, prediction endpoint switch, or full AI evaluation gate. A future phase should connect serving/version selection to ACTIVE, add candidate evidence approval, experiment runs, scheduled drift evaluations, and fine-grained super-admin permissions.

## Validation

Run `npm run check:mlops`, `npm run build`, and `npm run check:all` before merging. Perform a database-backed concurrency test with two concurrent promotion requests and a rollback test on a disposable Neon branch. No production model registry data should be modified by these tests.
