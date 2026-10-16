# Phase 2–4 source-agnostic release checklist — 16 October 2026

**Status: blocked for a production cutover.** Existing application CI and
Production Railway deployment are green, but they do not prove ten-feed
source parity, real object-storage restart safety, or published data correctness.

## Observed infrastructure (read-only live inventory)

| Environment | App service | MySQL | Object storage |
|---|---|---|---|
| Railway Testing | absent | present | absent |
| Railway Playground and new ideas | PR109-validation preview | not listed | newchanges-semantic-playground |
| Railway Production | NewChanges on main | not listed | newchanges-semantic-snapshots |

Do not assume absence of a resource here proves a database connection
does not exist outside the environment: only the Railway resource inventory
was checked. Do not connect Testing to the Production database as a shortcut.

## Phase 2: Real ten-feed rehearsal (blocking)

- Provision an isolated NewChanges Testing worker/app with restricted source credentials
  and explicitly approved expected reporting schema mappings; never use MySQL root.
- Discover the ten source feed tables and identify semantic fields, joins,
  effective dates, tombstones, employer identity, required currencies and timestamps.
- Obtain read-only consistent-source extraction over bounded pages and verify
  source index plans; enforce the 64 MiB exploratory transfer cap by default.
- Collect all ten canonical feed row counts, per-feed SHA-256 reconciliations,
  watermarks and source vs staged parity evidence.
- Measure real transfer bytes, wall time, memory peak, source query cost and
  projected Neon write/resident size. Any limit breach aborts before publication.

## Phase 3: Production-safe recovery and semantic publication (blocking)

- Validate signed object PUT, GET, SHA-256, loss of connection and replay on
  a real *non-production* S3-compatible bucket.
- Deploy a reviewed, backup-protected fenced checkpoint migration on an
  isolated Neon branch; test concurrent Railway/Render writers and lease expiry.
- Prove recovery from a changing source with CDC/immutable snapshot or a
  separately validated replay. A new MySQL transaction snapshot is not the old one.
- Prove canonical history/tombstone treatment, transactional Neon's semantic
  processing, per-tenant isolation, commit atomics and rollback/parity.
- Disable legacy source switching while a generation is publishing; do not
  use the already-green PR preview tests as evidence of these gates.

## Phase 4: Controlled cutover (blocked until Phase 2+3 evidence exists)

- Security and operator approval, exact active/candidate identities, fresh
  reconciliation within the last 60 minutes, separate rollback approval.
- A source-of-truth cutover plan with a maintenance/rollback window, independent
  backups, target capacity and at least one clean end-to-end rehearsal.
- Run `evaluateTenFeedCutover` with independently attested evidence. Green CI
  is a *code quality* gate, not automatic approval to cut over or delete sources.
- Only after all prerequisites: promote one generation using an atomic sequence,
  verify live dashboards and safe rollback, then enable scheduled refresh.
- Observe query costs and user-facing freshness after release.

## Immediate next operations

1. Decide whether to provision a Testing app and object bucket; this adds
   hosting/storage costs. The user has consistently prioritised low costs.
2. Supply and approve *actual* source schema field mappings. Neither automated
   name matching nor CI can infer business meaning of arbitrary databases.
3. Authorise the real-source, non-production rehearsal with read-only credentials
   before any connection or extraction is made.
4. Do **not** activate production imports, semantic publication, replacement,
   purge workflows, source switching, or rollback before evidence exists.

This checklist does not assert that the staged test modules automatically
perform Phase 2–4. It documents what is still required to claim completion.
