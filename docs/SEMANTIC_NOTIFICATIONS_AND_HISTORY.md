# Cross-instance semantic notifications and historical correction planning

## New in PR 109
- `GET /api/admin/mlops/semantic-publication-changes?afterId=...` reads persisted publication audit records with a stable (timestamp,id) cursor. Railway and Render can see the same committed changes without sharing process memory. Access is Admin-only and bounded to 100 events per request.
- `expandHistoricalRefresh` conservatively expands changed month to the current reporting month, coalesces overlaps, propagates tombstones, and rejects unbounded expansion. Tests cover retroactive correction and processing budget limits.

## Still guarded
This is a durable *polling protocol*, not yet push notifications to end-user clients. Application authorization must scope notifications to each user's employer permissions before opening this to normal users. Historical planner requires feed-specific effective date metadata and an actual transactionally generated change outbox; it is not yet wired to the importer.

## Production requirements
- Correctly handle generation/manifest access controls and never expose secrets, private object keys or source connection data in browser notifications.
- Implement replay cursor expiration/retention and periodic recheck of the current published version in case event history is compacted.
- Configure a real bucket and server-side credential broker. The Railway bucket is staged only, not provisioned.
- Migrate Prisma schema safely in staging, test full and retroactive dashboard parity, then canary before switching serving paths.
