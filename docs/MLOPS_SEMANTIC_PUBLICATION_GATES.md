# Governed semantic publication and MLOps release gates

## Committed schema and service foundations
- SourceGeneration: non-secret logical source identity and validation state.
- SourceGenerationCursor: independent ten-feed checkpoints for each generation.
- SemanticSnapshotManifest: immutable object reference, version, watermark, digest, size.
- SemanticPublicationPointer: one latest manifest pointer per employer / period / partition.
- SemanticPublicationAudit: append-only reason and previous/next manifest IDs for prospective rollback.
- semanticPublicationGates.ts: deterministic fail-closed quality checks, plus Admin readiness query.

## Non-negotiable transaction semantics for future activation
The live publisher must never assume a candidate's metadata proves source equivalence or that bytes actually exist. It must:
1. Verify encrypted credential reference and candidate source identity through a freshly tested connection.
2. Acquire a cross-host writer lease; use serializable transactions or an optimistic generation compare-and-swap.
3. Confirm reconciliation of the full set of ten source feeds and verify all source tombstones and key continuity.
4. Write immutable analytical objects to a *real external durable storage provider*; read back and verify SHA-256 and content length before inserting a validated manifest.
5. Apply deterministic MLOps integrity, completeness, freshness and drift gates. Treat ML drift signals as alerts or human-review requirements, never silent destructive corrections.
6. Atomically update SemanticPublicationPointer and write SemanticPublicationAudit in the **same** PostgreSQL transaction, conditional on the previously published version. Never switch the app's SQL source connection before this step.
7. Invalidate version-aware application caches and notify Railway/Render clients by shared notification/version polling; in-memory events alone do not cross providers.
8. Keep the old object generations and checkpoint states for reversible rollback and reconciliation.

## Current release guard
Currently source activation and semantic publication are *disabled*. Storage verifier is intentionally hardcoded to fail readiness. Schema entries for publication pointers are not themselves an atomic publication engine. None of the unimplemented steps should be described as production-ready.

## Cost strategy
Move only changed canonical rows. Build employer/period/site/income partitions from changed natural keys, debounce bursts, and use immutable per-partition files instead of writing every intermediate calculation to Postgres. Never trigger a full purge simply because a database host or password changes. Preserve source history according to retention and audit requirements.
