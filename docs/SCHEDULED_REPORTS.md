# Scheduled reports

Scheduled reporting sends employer dashboard reports using the saved report context and employer/channel-partner branding.

## Configuration

Administrators configure SMTP under:

**Administration → System Email & Scheduled Reports**

SMTP can be configured through the portal or through the `SMTP_*` environment variables described in [.env.example](../.env.example).

Always use **Send test email** before enabling scheduled delivery.

## Schedule context

A scheduled report stores the report context rather than only a filename.

The saved context can include:

- reporting window;
- site filter;
- income filter;
- frequency;
- send time;
- timezone.

Rolling windows are recalculated when the report is sent.

## Frequencies

Supported recurring frequencies include:

- once;
- daily;
- weekly;
- monthly.

The scheduler calculates the next run using the persisted schedule state.

## Delivery persistence

Schedules and delivery logs are stored in PostgreSQL.

They therefore survive:

- application restarts;
- Railway deployments;
- process replacement.

The scheduler claims due work through database-backed state to reduce duplicate sends when more than one process attempts to evaluate due schedules.

## Branding

Scheduled employer reports use the employer's channel-partner branding when a partner is configured.

This keeps automated reports consistent with the dashboard experience.

## Failure behaviour

A failed scheduled delivery must be visible in the delivery state/log.

A manual **Send now** failure must not incorrectly move the persisted recurring schedule into an automatic retry window intended for scheduled execution.

## Regression check

Run:

```bash
npm run check:scheduling
```

The scheduling regression suite verifies SMTP transport behaviour, recurrence calculations, dashboard rebuild context, partner branding, database-backed due-schedule claiming and the scheduling API.

## Operational checklist

Before enabling scheduled reports in production:

- verify SMTP credentials;
- send a test message;
- confirm sender/recipient policy;
- verify timezone;
- create one test schedule;
- confirm the saved filters;
- verify the delivery log;
- verify partner branding where applicable;
- confirm the schedule survives a deployment;
- confirm a failure is visible and does not corrupt the recurring schedule.
