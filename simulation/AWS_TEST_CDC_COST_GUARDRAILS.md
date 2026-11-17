# Budget-controlled AWS test database CDC experiment

**Target:** Existing AWS RDS MySQL **test** instance only, after a metadata-only source review. This document does not grant database access, execute DDL/DML, change RDS configuration, or enable a scheduled worker.

## Cost policy

- Reuse the existing MySQL test instance and local developer machine. **Do not** provision a second RDS instance, RDS read replica, DMS, MSK/Kafka, Kinesis, always-running EC2, Lambda schedule, cache cluster, or paid stream service for the pilot.
- Keep the first workload to exactly ten representative *synthetic* records, three short committed transactions (INSERT, UPDATE, DELETE) and bounded metadata-only CDC output. The local Python driver produces 30 markers. Actual AWS views may not support the fixture fields and require independent mapping.
- Verify existing AWS RDS instance class, allocated/free storage, backup retention, CloudWatch CPU, connections, burst credits and binlog storage before any configuration change. Never blindly enable 24-hour retention; it may grow storage and impact the micro instance. Use an approved short replay horizon only after measuring daily binlog generation and interruption recovery.
- Avoid long-lived polling/consumer loops until lag, checkpoints and alerts work. Start with a **manual operator-invoked, bounded smoke test**, stop on failure and leave no always-on resources.
- Reject any unbounded batch, high-frequency loop, full-table reporting refresh or dashboard query that can exhaust RDS CPU/IOPS; run business aggregates with fixed row/latency limits.
- Prefer local Docker (zero new AWS infrastructure) for full insert/update/delete validation. Use read-only AWS metadata inspection to establish the ten real view definitions and physical-table lineage before writing any data.

## AWS test-only gates (all mandatory)

1. Confirm instance ARN/region and the account owner explicitly identifies the RDS instance as **non-production**. Confirm the ten `ingest_stage.v_*` are test views and list their source tables and DML-safe synthetic keys; **do not** reuse fixture SQL against them.
2. Record an independent consistent snapshot/import handoff for the nonempty source. The local bootstrap shortcut is **invalid** on populated RDS.
3. Review whether global binlog replication privileges expose other schemas. Use dedicated scoped credentials and TLS hostname verification; never use master/root credentials. The test-only label does not by itself prove the absence of sensitive data.
4. Capture current retention, available free space and binlog activity; approve an explicit retention cap and stop criteria. Verify production application is not consuming these test feeds.
5. Map a dedicated synthetic namespace/tenant/employer to every reporting view and confirm that deletes cannot cascade into historical or real source rows. If this cannot be guaranteed, use an isolated scratch schema or stay local.
6. Use a **manual one-shot run** with separate source write and CDC read identities; automatically stop after three transactions or the first exception. Record source counts, binlog coordinates, feed notifications, query parity and elapsed time.
7. Capture evidence and tear down any temporary resources. No silent merge/deploy/activation.

## What current code proves

`simulation/ops/demo-ten-feeds-local.sh` runs Docker's disposable fixture and verifies ten locally simulated `v_*` views, stale watermark UPDATEs, DELETE tombstones, per-feed notifications, and metadata checkpoints. It does **not** connect to the AWS RDS test instance or update The Fixer's deployed dashboard.

## Exit criteria

- 10/10 feeds register INSERT, UPDATE and DELETE, each with correct event metadata and checkpoint.
- Exactly 30 expected test row-change markers with per-feed generation 3.
- Every local test view matches synthetic expected state after each transaction.
- No simulated, real or sensitive row payloads written to the CDC metadata sink.
- The AWS application-specific demo additionally must prove a successful read-only aggregation and dashboard publication, not just detection. Until then UI status must say **not connected**.
- No new billable cloud resources and no unreviewed RDS setting changes.


## New: safe AWS test metadata probe (no source writes)

For a manual inspection of the REAL RDS test instance's ten view contracts, use:

```bash
cd ~/NewChanges/simulation
python3 -m pip install --user 'PyMySQL[rsa]'
export FIXER_AWS_TEST_READONLY_APPROVED=YES_METADATA_ONLY
export FIXER_RDS_TEST_HOST='<approved RDS endpoint from AWS>'
export FIXER_RDS_TEST_USER='<dedicated metadata-only account>'
export FIXER_RDS_TEST_CA='<path to official RDS CA bundle>'
export FIXER_RDS_TEST_PASSWORD='<obtain securely from your environment/secret store>'
python3 -m ops.aws_test_readiness
```

**Do not paste credentials into ChatGPT, GitHub or terminal logs.** Prefer a local secret manager, environment injection or a hidden prompt. The code requires a TLS CA and host ending `.rds.amazonaws.com`, rejects administrator usernames, and does not connect without explicit read-only approval. It queries only `information_schema.TABLES`, `information_schema.COLUMNS` and MySQL global variables; it makes **zero** data-row queries or mutations. Its output intentionally never prints hosts, usernames, credentials or SQL definitions.

The probe cannot independently verify binlog retention, broad replication privilege scope, snapshot handoff or dashboard parity. Those remain separate approval gates; this tool never enables a consumer. Use the returned missing-view / missing-key flags to prioritize source-to-view mapping work. No new AWS resources are created.
