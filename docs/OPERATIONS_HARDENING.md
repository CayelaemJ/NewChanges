# Operations hardening

This document covers the operational controls that cannot be fully closed by
application code alone. Each section states the current state, the required
procedure, and the evidence to retain. It complements the control register in
[../SECURITY_ASSESSMENT.md](../SECURITY_ASSESSMENT.md).

## 1. Secrets inventory and rotation

Secrets live only in Railway variables (or the approved secret store). Maintain
an inventory with an owner, purpose, storage location and rotation interval for
each credential:

| Secret | Purpose | Storage | Owner | Rotation interval | Last rotated |
|---|---|---|---|---|---|
| `DATABASE_URL` | PostgreSQL application access | Railway variables | _TBC_ | 90 days | _TBC_ |
| `ADMIN_PASSWORD` | First-run admin bootstrap (remove after use) | Railway variables | _TBC_ | one-time | _TBC_ |
| `SOURCE_SQL_PASSWORD` | Read-only source database | Railway variables | _TBC_ | 90 days | _TBC_ |
| `SOURCE_API_TOKEN` | External API integration | Railway variables | _TBC_ | 90 days | _TBC_ |
| `SMTP_PASSWORD` | Outbound email | Railway variables | _TBC_ | 180 days | _TBC_ |
| `ERROR_WEBHOOK_URL` | Error reporting endpoint (optional) | Railway variables | _TBC_ | 180 days | _TBC_ |

Procedure to prove rotation works: rotate one credential using the documented
steps, confirm dependent services recover, then record the date and evidence.
`ADMIN_PASSWORD` should be removed once the first admin exists — it is only read
when the database has no users.

## 2. Database least privilege

The application runtime account must not be the database owner. Create separate
roles:

```sql
-- Runtime account: read/write application tables, no DDL, no superuser.
CREATE ROLE efs_app LOGIN PASSWORD 'REPLACE_ME';
GRANT CONNECT ON DATABASE efs TO efs_app;
GRANT USAGE ON SCHEMA public TO efs_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO efs_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO efs_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO efs_app;

-- Migration account: elevated, used only by the pre-deploy step.
CREATE ROLE efs_migrate LOGIN PASSWORD 'REPLACE_ME';
GRANT ALL PRIVILEGES ON DATABASE efs TO efs_migrate;

-- Optional read-only reporting account.
CREATE ROLE efs_report LOGIN PASSWORD 'REPLACE_ME';
GRANT SELECT ON ALL TABLES IN SCHEMA public TO efs_report;
```

The pre-deploy migration step should run as `efs_migrate`; the running
application should use `efs_app`. Review privileged database users periodically.

## 3. Backup and restore drill

A backup is not tested merely because the provider reports success. Before
treating the service as enterprise-ready, restore a recent production backup
into an isolated non-production database and record:

- backup timestamp and provider;
- restore start/end and total duration;
- schema and application version restored;
- integrity checks and representative read-only business queries;
- measured data-loss window (RPO) and recovery duration (RTO);
- approver, and any gap versus the agreed targets with an owner and due date.

Restored personal data must be access-controlled, sanitised or destroyed once
the drill is complete. Do not use destructive reset options against production.

## 4. Observability and alerting

Available controls:

- `GET /health` — readiness; returns `503` when the database is unreachable.
- `GET /health/live` — liveness; process-only, no dependencies.
- `GET /version` — deployed build/contract version.
- `LOG_LEVEL` — pino log level (`info` by default).
- `ERROR_WEBHOOK_URL` — optional endpoint that receives redacted error events
  (no request bodies, cookies or tokens) for 5xx responses, unhandled
  rejections and uncaught exceptions.
- In-app security alerts and admin email/Slack notifications.

Required evidence: document monitoring coverage and thresholds, then trigger a
controlled test for each critical alert (uptime, error rate, database
availability, scheduled-report delivery) and retain the delivery/acknowledgement
record and escalation owner. Forward application logs to a central, access-
controlled store with defined retention; never send credentials or request
bodies.

## 5. Retention and deletion

Retention policies are recorded (`RetentionPolicy`) with a rule, deletion
method, legal basis and a `legalHold` flag. Automated deletion is intentionally
**not enabled**: deletion requires a reviewed mapping from each data class to
the concrete tables/records it covers, a documented deletion method, and
legal/privacy sign-off. Until that exists, retention is enforced by review.

## 6. Independent reporting validation

Before promotion, a reviewer independent of report implementation must reconcile
selected periods, cohorts and totals against the authoritative source, record
discrepancies and their resolution, and sign off. See the release runbook for
the required evidence.
