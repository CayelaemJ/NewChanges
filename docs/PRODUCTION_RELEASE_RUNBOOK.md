# Production release runbook

## Release flow

1. Feature work occurs on a pull request branch.
2. CI must be green, including build, security, UI, imports, scheduling, score, period-comparison, accessibility, performance and brand gates.
3. Verify the rendered PR build across desktop, tablet, portrait phone and landscape phone.
4. Merge to main.
5. Railway Production must deploy from main, not from a feature branch.
6. Verify /health and /version after deployment.
7. Confirm reporting-period comparisons and data-quality state on a real employer dashboard.

## Production topology

The live service should treat main as the production release source. Preview or staging should be used for pull-request verification. The current Railway service configuration must not remain permanently attached to the enterprise-mobile-ratings-v2 feature branch after this work is accepted.

## Post-deploy smoke checks

- Authentication and logout.
- Employer isolation.
- Month versus previous month comparison.
- Quarter versus previous quarter comparison.
- Programme-to-date versus same period last year.
- Full financial values without k or m abbreviations.
- Creditor drill-down on portrait and landscape phone.
- Financial-problems-resolved drill-down on desktop.
- Income-band reach rendering and filter respect.
- Scheduled report configuration and send-now flow.
- Data-quality warning visibility.

## End-to-end and reporting evidence

For each release candidate, retain the build/version, test date, environment, tester, and pass/fail result. Static regression checks are necessary but do not replace these runtime checks.

- Exercise authentication, logout, employer isolation, filters, drill-downs, scheduled reports, and error/empty-data states in a real browser at desktop, tablet, phone portrait, and phone landscape sizes. Record screenshots or test output for failures and verify keyboard/focus behavior on critical admin flows.
- Reconcile at least three closed reporting months and the current month-to-date period against the authoritative source. Include portfolio and employer totals, date boundaries, site/income cohorts, missing-feed behavior, and at least one empty cohort. Use the same as-at date and filter context on both sides.
- Have a reviewer who did not implement the report independently verify the source extracts, calculation rules, and displayed totals. Record the reviewer, source/query or extract identifiers, periods/cohorts checked, differences, resolution, and sign-off. Do not promote while unexplained material differences remain.
- Run a controlled production alert test and verify it reaches the on-call destination and is acknowledged. Preserve the alert and acknowledgement identifiers; do not use real customer data in test events.

## Recovery

Keep a known-good deployment available for rollback. Database schema changes must be additive or explicitly planned. Do not use destructive reset options in Production.

Before release, restore a recent production backup into an isolated non-production database. Record the backup timestamp, restore start/end, schema and application versions, integrity checks, representative read-only business queries, measured data-loss window and recovery duration, and approver. Verify access controls and sanitise or restrict restored personal data. A backup is not considered tested merely because the provider reports that it completed.

## RPO/RTO

Document the acceptable data-loss window and recovery time with the production owner. Compare the measured restore result to those targets and record any gap with an owner and remediation date. Test database restoration before treating the service as enterprise-ready.

## Release blockers

Use the status and evidence gates in [the security assessment](../SECURITY_ASSESSMENT.md) as the control register. Production configuration must be verified rather than inferred from source code. Do not describe the service as independently tested, MFA-protected, restorable within target, centrally monitored, or independently reporting-validated until the corresponding evidence is attached to the release record. Critical/high external security findings and unexplained material reporting differences block promotion.
