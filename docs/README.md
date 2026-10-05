# Documentation

This directory is the operational and technical documentation set for the empower-fin Dashboard Portal.

The repository README is the short entry point. This directory contains the deeper material needed to build, operate, review and release the system.

## Start here

| Document | Purpose |
|---|---|
| [Architecture](ARCHITECTURE.md) | System boundaries, routes, services, data flow and current frontend model |
| [Deployment](DEPLOYMENT.md) | Local, Railway and container deployment |
| [Testing](TESTING.md) | Regression checks, CI gates and UI verification |
| [Scheduled reports](SCHEDULED_REPORTS.md) | SMTP, report schedules, delivery and troubleshooting |
| [Date/filter semantics](DATE_FILTER_SEMANTICS.md) | Historical reporting and as-of/flow rules |
| [Production release runbook](PRODUCTION_RELEASE_RUNBOOK.md) | Release, smoke testing, evidence and recovery |
| [Enterprise portal standard](ENTERPRISE_PORTAL_STANDARD.md) | Portal standards and product expectations |
| [Optimise integration specification](OPTIMISE_INTEGRATION_SPEC_V2.md) | External integration contract |
| [Alignment review](ALIGNMENT_REVIEW.md) | Why the current dated-data model exists |
| [Performance](PERFORMANCE_100K.md) | Large-data performance notes |
| [Security hardening review](HARDENING_REVIEW.md) | Historical hardening and security review |
| [Security assessment](../SECURITY_ASSESSMENT.md) | Current security/operational control register |

## Root-level controls

- [README](../README.md) — repository landing page
- [SECURITY.md](../SECURITY.md) — vulnerability reporting and security baseline
- [SECURITY_ASSESSMENT.md](../SECURITY_ASSESSMENT.md) — security assessment and open evidence items
- [PRODUCTION_READINESS.md](../PRODUCTION_READINESS.md) — production-readiness pass and release gate
- [SOUTH_AFRICA_COMPLIANCE.md](../SOUTH_AFRICA_COMPLIANCE.md) — South Africa compliance notes

## Documentation rules

Documentation is maintained with the code.

When a pull request changes externally visible behaviour, deployment, data semantics, security controls, reporting, integrations or release procedures, update the relevant documentation in the same pull request.

Prefer one authoritative document over several overlapping notes. If an older document is retained for historical context, label it as such rather than allowing it to look like the current operating procedure.

## Current architecture note

The production dashboard remains the established `public/dashboard.html` implementation at `/dashboard`. The React implementation is available at `/react/dashboard` as the migration workspace.

This distinction is deliberate and must remain explicit until React reaches verified visual and functional parity.

## Versioning

The application version is defined by `package.json` and the repository `VERSION.txt`. Documentation should not invent a separate application version.

For the current repository state, the application version is **0.10.0**.
