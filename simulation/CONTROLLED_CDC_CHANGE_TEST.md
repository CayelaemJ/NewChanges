# Controlled CDC change test — strictly isolated first phase

AWS metadata audit passed on 17 November 2026, but this DOES NOT
authorize any INSERT/UPDATE/DELETE on AWS RDS. The real RDS tables
contain populated business data and reporting views. We will NOT change
existing employer, employee or financial records to trigger a CDC event.

## What this branch adds

- `schema/005_disposable_cdc_test.sql`: a NEW, local-only
  `cdc_disposable_fixture.employers` table, separate from
  `ingest_stage`.
- `runtime/disposable_cdc_mutations.py`: an opt-in *application-layer*
  helper that makes three independently committed changes to a reserved
  synthetic primary key. The helper refuses the real source schema and
  connections without an explicit local-only attestation.
- `tests/test_disposable_cdc_mutations.py`: unit tests; **not** proof
  of a live MySQL stream or actual database mutation.

Do not apply `005_disposable_cdc_test.sql` or the helper to RDS.
The test's local source table is not part of the ten canonical feeds;
the production-facing AWS capture probe must not have its table allowlist
expanded merely for testing. A separate isolated Docker binlog test can
use this fixture without changing production allowlists.

## Run offline tests

```bash
cd ~/NewChanges/simulation
source .venv/bin/activate
python -m unittest discover -s tests -p 'test_disposable_cdc_mutations.py' -v
```

## Missing before the actual AWS write-read integration test

1. Separate test environment or approved disposable table and schema,
   protected from real reporting views and customers.
2. Explicit write authorization and a least-privilege test-writer account.
3. Approved fixture mapping from actual column metadata and guarantees for
   cleanup, uniqueness, and data isolation.
4. Reader running **before** the independent committed test changes,
   with observed INSERT + XID, UPDATE + XID, DELETE + XID.
5. Durable, lease-protected production checkpoint and frontend notification
   wiring. The existing SQLite reference store alone is not sufficient.

This change deliberately makes zero AWS writes and starts no AWS stream.
