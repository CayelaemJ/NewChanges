# Development-only notification store (not an AWS deployment)

The `runtime/aws_notification_sqlite.py` reference store preserves **only** a
notification bootstrap, committed binlog coordinate, source identity, per-feed
generations and opaque commit digests. It does **not** store MySQL source rows,
personal identifiers or reporting copies. Changes to feed generations and
source position occur in a **single SQLite transaction**. Failed or stale
commits must leave both unchanged; replay of a known digest is idempotent.

This is **not** production ready: no distributed leader lease, replication
stream, tenant authorization, backup/recovery guarantee, or API integration;
the source allowlist hash is NOT a real view DDL dependency fingerprint.
SQLite must not be placed on ephemeral deployment disk nor shared by
uncoordinated workers. No AWS RDS state or schema is modified.

Offline tests:

```bash
cd simulation
python -m unittest discover -s tests -p 'test_aws_notification_sqlite.py' -v
python -m unittest discover -s tests -p 'test_aws_notification_contract.py' -v
python -m unittest discover -s tests -p 'test_cdc_generation_reload.py' -v
```

A future AWS worker must first verify an operator-approved notification
baseline and a **fresh** binlog inventory, enforce a source authorization
review, single-writer lease and secure TLS replication protocol, then persist
an XID-committed allowlisted event. A live dashboard must query MySQL views
and use double-checked generation counters to prevent missing updates.

Prefer the application’s existing durable transactional store for deployed
checkpoint/generation state (with migrations and tenant guards), rather
than introducing another always-on database. Do not activate CDC or seed
the checkpoint from the current binlog position without the explicit
notification-only bootstrap/reconciliation procedure.
