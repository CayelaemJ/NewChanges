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

## Recovery

Keep a known-good deployment available for rollback. Database schema changes must be additive or explicitly planned. Do not use destructive reset options in Production.

## RPO/RTO

Document the acceptable data-loss window and recovery time with the production owner. Test database restoration before treating the service as enterprise-ready.
