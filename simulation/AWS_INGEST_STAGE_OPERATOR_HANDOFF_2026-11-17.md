# AWS RDS ingest_stage CDC — operator handoff (17 November 2026)

## Evidence observed through operator-driven, read-only checks

- AWS RDS MySQL 8.4.11, `fixer-synthetic-mysql` in `eu-north-1`.
- Verified TLS via AWS RDS global CA bundle and PyMySQL `ssl_ca` + `ssl_verify_cert=True` + `ssl_verify_identity=True`.
- `fixer_cdc_reader` can inspect metadata, `fixer_cdc_stream` authenticated over TLS; `SHOW GRANTS` checks reported `REPLICATION CLIENT`, `REPLICATION SLAVE`, and `ingest_stage` SELECT.
- `SHOW BINARY LOG STATUS` succeeded; `log_bin=ON`, `binlog_format=ROW`, `binlog_row_image=FULL`.
- Operator reports `mysql.rds_show_configuration` displays `binlog retention hours=24`. This requires ongoing storage monitoring on the 20-GiB instance.
- `information_schema` reported only one non-system schema visible to the inspecting user: `ingest_stage`. This is **not** an independent security/data-classification clearance.
- 11 InnoDB base tables: `debt_accounts`, `employees`, `employers`, `import_manifest`, `journeys`, `platform_users`, `policies`, `ratings`, `referrals`, `salary_advances`, `workforce_snapshots`.
- 10 views: `v_debt_accounts`, `v_employees`, `v_employers`, `v_journeys`, `v_platform_users`, `v_policies`, `v_ratings`, `v_referrals`, `v_salary_advances`, `v_workforce_snapshots`.
- The 10 canonical physical feeds have primary key `_ingest_id`; the views do not expose that key. All ten expose `source_updated_at` and `employer_ref`. `import_manifest` uses `dataset` as key and is excluded.
- **No AWS live CDC consumer, historical snapshot import, dashboard push, or durable AWS checkpoint has been demonstrated.** Local Docker CDC proofs do not establish live AWS correctness.

## Next safety and engineering gates (in order)

1. Inspect real source schema/column types and view dependencies using **metadata only**. Confirm the ten `v_*` views actually select from corresponding canonical tables; matching names do not prove dependency.
2. Classify data sensitivity (employees, policies, debt) and approve replication exposure. Global `REPLICATION SLAVE` can expose row events outside the allowlist; an application filter is not an access-control boundary. Restrict CDC account source IP when runtime is chosen.
3. Decide sink durability/storage and where the long-lived consumer runs (not a laptop, not a short-lived per-request web process). Budget binlog retention storage. Review rotation and backup/restore of HMAC key and checkpoint.
4. Establish a consistent baseline: coordinate a source snapshot with an exact binlog start coordinate, persist/import a **verified** manifest and baseline before acknowledging events. Do **not** seed an empty, non-snapshot consumer with today's position and call it complete. No production changes without snapshot approval.
5. Add a separate, explicitly gated AWS runtime; leave `run_local_binlog` Docker-only. Test TLS + permissions read-only, then controlled bounded binlog streaming in an approved environment. Review SSL support of the replication protocol client separately from PyMySQL SQL connections.
6. Persist deduplicated opaque event markers and commit checkpoint **atomically** in a durable sink. Do not copy personal/financial row images into logs/metadata. Define loss recovery when a checkpoint points to purged logs.
7. Resolve source→view→dashboard dependency mapping, including correlated joins, cross-feed measures and out-of-order events; notify live clients (SSE/WebSocket) to requery MySQL on change, not to treat binlog data as view output.
8. Run safe insert/update/delete tests using approved isolated test data only; validate transaction commits, rollback, deletes, restarts, duplicate replay, capture lag and dashboard results. No AWS data mutation by preflight scripts.

## Read-only schema follow-up in DBeaver

```sql
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, COLUMN_KEY, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = 'ingest_stage'
  AND TABLE_NAME IN (
    'debt_accounts','employees','employers','journeys','platform_users',
    'policies','ratings','referrals','salary_advances','workforce_snapshots'
  )
  AND (COLUMN_KEY='PRI' OR COLUMN_NAME IN ('source_updated_at','_source_updated_utc'))
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

Treat the above output as metadata only; do not request/export sensitive data rows.
