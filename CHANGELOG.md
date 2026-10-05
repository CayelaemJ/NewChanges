# Changelog

This file records notable repository-level changes. Detailed implementation history remains in Git commits and pull requests.

## 0.10.0 — current

### Brand and UI

- BrandEngine remains the active deterministic brand-recognition and theme system.
- Dark mode is token-driven.
- Partner branding continues to use the existing theme/brand-token model.
- The established production dashboard remains the canonical visual reference.

### Data and MLOps

- Governed MLOps telemetry and model lifecycle controls are present.
- Incoming data-quality guardrails assess abnormal imports and live syncs before live-table writes.
- Blocked quality events are recorded for administrator review.

### Reporting

- Scheduled reporting persists schedules and delivery logs in PostgreSQL.
- Reports rebuild dashboard data using the saved reporting context.
- Partner branding is applied to scheduled employer reports.

### React migration

- The React workspace remains available at `/react/dashboard`.
- The canonical production route remains `/dashboard`.
- React migration checks exist separately from the canonical dashboard route.

## Recent production fixes

### PR #73 — restore default dashboard theme for admins

Restored the standard dashboard theme for Admin and Super Admin users and prevented the portal palette from replacing the main dashboard's default privileged-user theme.

### PR #72 — restore live dashboard wellness gauge

Fixed the gauge on the actual production `/dashboard` route by restoring the missing SVG gradient and using `pathLength="100"` for reliable score rendering.

### PR #71 — restore default dashboard colours

Restored the standard dashboard colour palette for Admin and Super Admin.

### PR #68 — restore original dashboard as canonical route

Returned `/dashboard` to the established production dashboard while keeping the React implementation separately available for continued migration work.

### PR #67 / PR #65 — React dashboard route recovery

Addressed the React white-screen and canonical-route transition issues encountered during the React migration.

## Historical work

Earlier releases added dated reporting semantics, unified source ingestion, enterprise UI/security hardening, channel-partner branding, scheduled reporting, accessibility/performance checks and production-readiness controls.

For detailed historical context, use Git history and the documents under [docs/](README.md).

## Documentation policy

If a release changes architecture, deployment, data semantics, security, reporting or user-visible behaviour, update this changelog and the relevant technical document in the same pull request.
