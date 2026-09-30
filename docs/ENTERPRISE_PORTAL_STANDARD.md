# Enterprise portal standard

This document defines the release bar for the empower-fin dashboard portal.

## Product experience

- Executive insight at the top of the employer dashboard.
- Visible data-quality status with drill-down warnings and source coverage.
- Saved views based on current reporting filters and shareable URLs.
- Quick actions for long dashboards.
- One canonical visual language for cards, KPIs, tables, drawers, charts, filters and states.
- Full financial amounts in all user-facing financial displays.
- Exact reporting-period comparison labels.
- Responsive layouts for desktop, tablet, portrait phone and landscape phone.
- Reduced-motion and keyboard-accessible interaction patterns.

## Analytics and charts

Every time-series chart must receive the selected-period series, the like-for-like comparison series, an explicit unit, an explicit current label, an explicit comparison label, and a data-derived readable scale.

Month selection means previous-month comparison. Quarter selection means previous-quarter comparison. Programme-to-date means the same elapsed period in the prior year. Zero is a valid financial data point and must render as zero rather than becoming an empty chart.

## Data trust

The dashboard distinguishes Good, Attention and Incomplete data quality states. Warnings remain visible in the data-quality drill-down.

## Reporting

The reporting layer should support Executive, Management and Operational detail using the same calculation path as the live dashboard, with scheduled delivery, PDF export, filter context, generated timestamp and reporting window.

## Access and governance

Intended role model:
- Platform Admin
- Partner Admin
- Employer Executive
- Employer Analyst
- Employer Viewer
- Report Operator

Existing employer authorization, section access, audit logging and partner isolation remain mandatory.

## Operations

Target release flow: feature branch -> CI -> staging or preview -> browser and device verification -> main -> production.

Production should not follow a feature branch directly.

Operational controls include /health, /version, structured logs, request and error correlation, dependency audit, accessibility regression, performance regression, score regression, UI regression, import and scheduling regression, tested database recovery, and documented RPO and RTO.

## Performance

Monitor dashboard response latency, p95 API latency, document size, stylesheet size, database query duration, cohort-cache hit rate, report generation duration, memory peaks, and scheduled-report failures.

Large employers must use the indexed dashboard cohort and read-model path rather than rebuilding all source tables per request.

## Benchmarks and alerts

Peer benchmarks and alerts are controlled features. They require an anonymisation policy, minimum cohort-size rules, a published benchmark methodology, and a clear distinction between measured facts and model estimates.

Alerts must use explicit user-visible rules and thresholds.

## Design principle

The portal is a financial-services analytics product. Readability, traceability, auditability and consistency take priority over decorative effects.

A dashboard is not release-ready simply because it compiles. It is release-ready when the numbers are correct, the comparison window is explicit, the data quality is visible, and the same experience works across supported viewport classes.
