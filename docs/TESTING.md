# Testing and quality gates

The project uses layered regression checks rather than treating compilation as the only definition of correctness.

## Local baseline

Start with:

```bash
npm ci
npm run build
```

Then run the focused checks for the area changed.

## Core checks

```bash
npm run check:production
npm run check:security
npm run check:ui
npm run check:imports
npm run check:scheduling
npm run check:brand
npm run check:mlops
npm run check:mlops-data-quality
npm run check:accessibility
npm run check:performance
```

The aggregate release gate is:

```bash
npm run check:all
```

The repository also contains checks for period comparison, role perspective, enterprise operations, unified data ingestion, security identity/operations/governance and South Africa compliance.

## React migration checks

The React workspace has a dedicated typecheck and migration regression check:

```bash
npm run check:frontend:typecheck
npm run check:react
```

These checks are not a substitute for browser verification.

## UI verification

For dashboard or administration changes, verify at minimum:

- desktop;
- tablet;
- phone portrait;
- phone landscape;
- light mode;
- dark mode;
- keyboard/focus behaviour on critical controls;
- empty/loading/error states;
- real-data state;
- explicitly enabled synthetic-data state.

For the canonical dashboard, compare against the established production visual rather than judging the new UI in isolation.

## Data/reporting verification

For reporting changes:

1. verify at least three closed reporting periods;
2. verify current month-to-date behaviour;
3. test site and income filters;
4. test empty cohorts;
5. reconcile source totals against displayed totals;
6. test portfolio and employer views where applicable;
7. verify no demo/synthetic values are silently substituted for unavailable live data.

## Security verification

At minimum:

```bash
npm run check:security
npm run check:security-identity
npm run check:security-operations
npm run check:security-governance
npm audit --audit-level=high
```

Security-sensitive changes should also be reviewed for:

- authentication and authorisation;
- employer/tenant isolation;
- session handling;
- input validation;
- logging and redaction;
- dependency risk;
- browser security headers.

## CI

CI is the authoritative automated gate for pull requests.

A green deployment alone does not establish correctness. Production acceptance requires the relevant CI checks plus runtime smoke testing.

## Release evidence

For important releases retain:

- commit/PR;
- application version;
- environment;
- test date;
- checks executed;
- browser/device coverage;
- reporting reconciliation evidence where relevant;
- reviewer/sign-off for release-critical reporting/security controls;
- deployment and post-deploy smoke result.

See [PRODUCTION_RELEASE_RUNBOOK.md](PRODUCTION_RELEASE_RUNBOOK.md).
