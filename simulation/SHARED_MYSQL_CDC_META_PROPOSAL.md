# Shared MySQL CDC notification store — **proposal only, NOT deployed**

This document specifies a separate MySQL metadata schema for the existing
`ingest_stage` source. It must not be applied automatically to AWS RDS or
a customer source. A database owner must explicitly approve deployment,
backup/retention, writer credentials, TLS, failover and leader election.

**Never store this metadata in the PostgreSQL application database.**

## Proposed minimum MySQL DDL (manual DBA review)

```sql
-- DO NOT EXECUTE during normal application deployment or CI.
CREATE DATABASE IF NOT EXISTS fixer_cdc_meta
  CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;

CREATE TABLE fixer_cdc_meta.cdc_checkpoint (
  source_id VARCHAR(100) NOT NULL PRIMARY KEY,
  binlog_file VARCHAR(128) NOT NULL,
  binlog_position BIGINT UNSIGNED NOT NULL,
  generation BIGINT UNSIGNED NOT NULL,
  fence_epoch BIGINT UNSIGNED NOT NULL,
  updated_at_utc DATETIME(6) NOT NULL,
  CHECK (generation >= 0)
) ENGINE=InnoDB;

CREATE TABLE fixer_cdc_meta.cdc_feed_generation (
  source_id VARCHAR(100) NOT NULL,
  feed VARCHAR(64) NOT NULL,
  generation BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (source_id, feed),
  CONSTRAINT fk_feed_checkpoint FOREIGN KEY (source_id)
    REFERENCES fixer_cdc_meta.cdc_checkpoint(source_id)
) ENGINE=InnoDB;

-- Proposal only: retain each verified source XID digest for idempotent replay.
CREATE TABLE fixer_cdc_meta.cdc_commit_digest (
  source_id VARCHAR(100) NOT NULL,
  binlog_file VARCHAR(128) NOT NULL,
  binlog_position BIGINT UNSIGNED NOT NULL,
  digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  PRIMARY KEY (source_id, binlog_file, binlog_position),
  CONSTRAINT fk_digest_checkpoint FOREIGN KEY (source_id)
    REFERENCES fixer_cdc_meta.cdc_checkpoint(source_id)
) ENGINE=InnoDB;

-- Production design must additionally specify:
--  * approved baseline (source UUID, canonical schema fingerprint, binlog origin)
--  * leader lease fencing and takeover (fence_epoch must be DB-enforced)
--  * idempotent committed transaction digest / event deduplication
--  * atomic checkpoint and feed increments in one InnoDB transaction
--  * schema migration version, backups, retention, and disaster recovery
```

The existing offline SQLite prototype is **not** production multi-host state.
This DDL is a schema review sketch only, not a complete production CDC worker.

## Reader contract

`mysqlSharedGenerationReader.ts` reads only:

- `fixer_cdc_meta.cdc_checkpoint.generation` by exact server-issued source ID;
- all ten `fixer_cdc_meta.cdc_feed_generation` rows by that source ID.

The reader uses one consistent, read-only InnoDB snapshot. It fails closed for
missing, duplicated, unexpected, non-integer, or regressing values. Generations
must never exceed the committed checkpoint generation. No SQL writes are issued.

The **metadata-reader role** should have SELECT on those two tables only.
It must not have replication, schema mutation, source DML, or app-Postgres access.
A separate **CDC worker** with a carefully scoped writer identity would be
responsible for atomic InnoDB checkpoint and generation updates after verifying
actual committed MySQL XID transaction boundaries. The same DB host is not a
requirement: the schema may live in another approved MySQL instance, provided
the atomic commit contract and failover behavior are satisfied.

## Activation gates (all still outstanding)

1. Approve metadata schema, encryption, secrets and least-privilege roles.
2. Approve the binlog reader and baseline with durable binlog retention.
3. Prove single-leader fencing, replay/idempotence and crash recovery.
4. Prove shared-store cross-instance read consistency and notification latency.
5. Verify app employer IDs against the MySQL `employer_ref` scope.
6. Test INSERT/UPDATE/DELETE on the synthetic source, confirm chart changes.
7. Enable a separately gated worker and reporting preview only after signoff.

**Current status:** implementation and offline tests only. Neither a shared
MySQL metadata schema nor a live binlog producer has been deployed by this PR.

## Proposed metadata writer (offline code only)

`mysqlCdcCommitPlan.ts` validates a source-scoped committed-XID intent
and the ten canonical feed names before any connection is opened.
`mysqlCdcMetadataWriter.ts` uses a single InnoDB transaction with
`SELECT ... FOR UPDATE`, verifies the current `fence_epoch` and checkpoint
generation, checks an immutable commit digest, increments the affected feed
generations, and updates the checkpoint atomically.

**Important:** An upstream leader-election service must assign a monotonic
`fence_epoch` using database-enforced leasing. A caller-provided epoch alone
is not security or leadership proof. Binlog transaction boundaries and source
lineage must be verified independently. The writer intentionally has no
production connector or startup registration. A failed or uncertain COMMIT
must be reconciled by reading the durable digest before replaying; do not
publish an unverified notification.

Neither this sketch nor the offline SQLite store should be used for a live
cutover without an approved bootstrap, migrations, storage controls, and
crash/recovery tests.

## Disposable, actual InnoDB integration test (local Docker only)

After installing Docker and dependencies, explicitly opt in:

```bash
FIXER_CDC_RUN_DISPOSABLE_MYSQL=yes npm run check:cdc-mysql-disposable
```

This starts a fresh `mysql:8.4` Docker container with a random localhost-only
published port and random local-only password, creates the proposed metadata
tables **inside that container**, exercises the actual metadata writer and
read-only generation reader, and destroys the container on exit.

The integration exercises real database transaction visibility, two changed
feeds, digest replay and conflict, checkpoint progression, stale fencing
rejection, and process-local fanout for authorized employers. It does not
modify AWS RDS, the customer's MySQL database, or PostgreSQL.

**Limitations:** This integration uses a synthetic committed-XID plan. It does
not yet verify an actual MySQL ROW/FULL binlog consumer, lease elections,
multi-host notification publication, browser SSE transport, or automated
source-to-chart latency. These remain explicit release blockers.

This command is deliberately absent from `check:cdc-dashboard` and the default
CI/test pipeline because it requires local Docker and creates temporary DB
objects. It should never be run with production credentials.

## Real ROW/FULL binlog capture — disposable Docker exercise

An additional opt-in exercise now parses **real** local MySQL row-binlog
transactions using `mysql-replication` and the existing metadata-only Python
XID adapter. It does not connect to RDS or activate production CDC.

```bash
# One-time Python dependencies in your virtualenv (if not already installed)
python -m pip install -r simulation/requirements.txt

# Starts a fresh local MySQL 8.4 container with ROW/FULL, then destroys it
FIXER_CDC_RUN_DISPOSABLE_MYSQL=yes npm run check:cdc-binlog-disposable
```

The test creates `ingest_stage.journeys` **only inside the disposable
container** and snapshots a local binlog origin before three committed changes:
INSERT, UPDATE, DELETE. A fourth, rolled-back UPDATE must produce no committed
invalidation. The stream filters to the local `journeys` feed, accepts only
write/update/delete row events and the observed XID boundary, then checks
the SQLite development store records exactly three committed generations.
Source row images, employer identifiers and credentials are never printed.

**This is distinct from the shared-MySQL writer integration:** the binlog
exercise uses the existing Python SQLite development store. The previous
Docker test exercises the TypeScript MySQL metadata writer and relay using
synthetic XID proof. The two still need to be combined behind verified
leadership, durable shared metadata storage and a real authenticated browser
before any live CDC or no-manual-refresh claims.

The binlog exercise is NOT included in normal CI: it requires the explicit
opt-in environment variable, Docker and the Python `simulation/requirements.txt`
dependencies. Do not reuse customer credentials or external database hosts.
