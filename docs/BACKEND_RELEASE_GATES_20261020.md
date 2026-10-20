# Backend release evidence and remaining gates

This change repairs the production import path; it does not certify a production
cutover or activate an ingestion leader. PRs #161, #169 and #174 remain separate.

## Implemented

- SQL extraction uses at most 5,000 rows per query, stable timestamp/natural-key
  ordering and a transaction snapshot per feed. PostgreSQL LIMIT is parameterized
  correctly. SQL Server requires SNAPSHOT isolation to be available; MySQL source
  tables must support consistent transactional reads (for example InnoDB).
- The active importer consumes pages, validates the entire feed, rejects duplicate
  natural keys across pages and runs the existing first-50,000-row MLOps sample
  before writing live rows. It replays encrypted, private temporary staging pages
  in bounded chunks. No source records are added to logs or notification bodies.
- Staging is capped at 1,000,000 rows / 512 MiB per feed. Exceeding a cap fails
  explicitly without advancing that feed's cursor. Disk staging is disposable,
  not a durable checkpoint: after a crash, extraction retries from the last fully
  committed feed cursor. Prior committed chunks use the existing idempotent merge.
- A later validation/commit failure blocks downstream feeds; a partial commit is
  recorded FAILED and does not advance the feed cursor. Compatibility fallback
  cannot mark the complete audit COMMITTED after only its first page.
- API extraction requires HTTPS, bounded 8 MiB responses and same-endpoint cursor
  pagination: `?limit=5000&cursor=...`, with `{records, nextCursor}` responses.
  Bare arrays remain accepted within the response budget. Cursors must describe
  a stable source snapshot/window. Repeated cursors and excessive page counts fail.
  Test source checks every endpoint, but only its first page: not full parity.
- Interrupted runs are repaired under the global source-ingestion lease, never
  by guessing that an old timestamp means a live job is dead. Recovery runs on
  leader startup and before ingestion. Standby background settings stay unchanged.
- Source, watcher, MLOps and background snapshot failures persist an operations
  event for Admin before email is attempted. Delivery records distinguish provider
  acceptance from no email sent. This is not an inbox-delivery receipt or an
  automatically retried email outbox. The existing alert recipient is configured
  in Admin; credentials are never committed here.
- Legacy array-based equivalent-source reconciliation now fails above 50,000
  records instead of risking another process OOM. Large equivalent cutovers still
  require bounded independent reconciliation; this release does not bypass it.

## Verification

- TypeScript and changed-file ESLint.
- Encrypted staging validation/replay under a 192 MiB JavaScript heap, including
  318,043 synthetic employee observations and 120,000 synthetic employer records.
- Duplicate keys across pages, late invalid records, disk/row quotas, HTTP body
  bounds, orchestration in all ten-feed dependency order, and cursor preservation
  after a later commit failure.
- Transactional interrupted-run recovery with no cursor changes or repeated clean
  restart alerts. Existing sync, daily refresh, MLOps, scheduling and security guards.

## Required before production activation

1. Run database-backed tests on an isolated source and target: all ten feeds,
   multi-page updates, source changes during extraction, tombstones, compatibility
   fallback, process restart, dashboard score/period change and rollback. Unit
   mocks and the synthetic memory test are not proof of these external systems.
2. Replace the source root account with restricted SELECT-only credentials and
   verify TLS/certificates. Do not simply toggle TLS without testing the server.
3. Configure an authorized HTTPS email provider in Admin and send a test to
   tjantjies@empowerfs.co.za. Verify provider acceptance and inbox delivery; force
   a synthetic failure and confirm both Admin visibility and notification.
4. Enable exactly one authoritative ingestion leader on the chosen deployment.
   Do not enable the Render standby scheduler as part of this code change.
5. Verify source indexes and monotonic committed `source_updated_at` semantics in
   every view. Updates must advance that clock; hard deletes require tombstones.
   Indexed polling is near-real-time synchronization, not arbitrary change-data
   capture. Measure source-to-dashboard latency rather than promising 30–60s.
6. Prove the final Railway app/PostgreSQL configuration, migration and backup /
   restore path. No paid resources or production configuration are provisioned
   by these tests, and no source-switch/rebuild or production purge is performed.
