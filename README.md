# empower-fin Dashboard Portal

> Multi-tenant financial-wellness dashboard with employer, portfolio, administration, channel-partner and governed MLOps capabilities.

**Current version:** `0.10.0`  
**Source contract:** `2.6`  
**Runtime:** Node.js 22+ / TypeScript / Fastify / PostgreSQL / Prisma  
**Deployment:** Railway  
**Production dashboard:** `/dashboard`  
**React workspace:** `/react/dashboard`

---

## What this repository contains

The empower-fin Dashboard Portal is a production-oriented web application for presenting financial-wellness information across multiple employers and channel partners.

The repository currently contains two dashboard implementations:

- **Canonical production dashboard — `/dashboard`**: the established dashboard in `public/dashboard.html`. This remains the visual source of truth while the React implementation continues to mature.
- **React dashboard — `/react/dashboard`**: the active React/Tailwind/MUI implementation and migration workspace. It is intentionally separate from the canonical production route.

The backend remains Node.js/TypeScript. The application uses PostgreSQL through Prisma and runs as a single Railway service; the React build is produced as part of the application build.

## Core capabilities

### Employer and portfolio analytics

- Employer financial-wellness dashboard
- Portfolio view for authorised empower-fin and channel-partner users
- Date-aware stock and flow calculations
- Monthly, rolling and programme-to-date reporting
- Site and income-band filtering
- Financial comparisons and drill-downs
- Null-safe rankings and scale-aware currency formatting
- Accessible metric definitions and calculation help

### Administration

- User and role administration
- Employer and portfolio access controls
- Channel-partner configuration
- White-label partner branding
- Live data integration configuration
- Imports and data-quality visibility
- Audit/security information
- System email and scheduled reporting
- Synthetic test-data mode
- MLOps governance and telemetry

### Brand Engine

The existing BrandEngine remains part of the product. It provides deterministic colour analysis and theme control rather than relying on an external ML service.

It supports:

- OKLab/OKLCH colour analysis
- Dominant/secondary brand-colour detection
- Contrast enforcement
- Chart palette derivation
- Confidence and warning metadata
- Partner-specific light/dark theme tokens
- Admin correction/feedback
- Versioned brand-learning telemetry

### MLOps and data guardrails

The MLOps layer is designed as a governed application capability, not a separate Railway ML service.

It includes:

- data-quality assessment
- anomaly and distribution-shift detection
- KPI anomaly detection
- forecasting/assessment support
- append-only telemetry
- model/version lifecycle tracking
- human feedback
- promotion/rollback controls
- sync-triggered assessments
- incoming-data guardrails before live-table writes

Abnormal import/sync data can be quarantined before it reaches live tables, with the decision recorded for administrator review.

---

## Architecture at a glance

```text
Browser
  |
  +--> Public landing / legal / login
  |
  +--> /dashboard --------------------> canonical production dashboard
  |
  +--> /react/dashboard --------------> React migration workspace
  |
  +--> /admin, /users -----------------> administration surfaces
  |
  v
Fastify / TypeScript server
  |
  +--> authentication + authorisation
  +--> dashboard/report APIs
  +--> imports + validation
  +--> SQL/API sync
  +--> scheduled reporting
  +--> BrandEngine / theme services
  +--> MLOps governance
  |
  v
Prisma
  |
  v
PostgreSQL

External source options
  +--> HTTPS API
  +--> PostgreSQL / SQL Server / MySQL/MariaDB read-only views
  +--> CSV / XLSX / JSON imports
```

The detailed architecture and data-flow notes live in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Canonical data contract

The core integration contract contains 10 datasets:

1. `employers`
2. `workforce_snapshots`
3. `employees`
4. `platform_users`
5. `journeys`
6. `debt_accounts`
7. `policies`
8. `ratings`
9. `referrals`
10. `salary_advances`

Chat/voice-of-employee data is intentionally outside the core source contract because it is supplied by a separate system.

External SQL integrations expose the corresponding canonical views:

```text
v_employers
v_workforce_snapshots
v_employees
v_platform_users
v_journeys
v_debt_accounts
v_policies
v_ratings
v_referrals
v_salary_advances
```

The browser never receives source SQL credentials. Server-side imports and syncs pass through the same contract validation and data-quality path before data is committed.

---

## Reporting semantics

The portal distinguishes three different dates:

1. **Business event date** — when an event happened.
2. **Business effective/observation date** — the state that was true at a selected point in time.
3. **Technical change timestamp** — when a source record changed and belongs in an incremental sync.

This distinction is essential for historical reporting. Current employee, debt or policy state must not silently be projected backwards into earlier reporting periods.

The full model is documented in [docs/DATE_FILTER_SEMANTICS.md](docs/DATE_FILTER_SEMANTICS.md) and [docs/ALIGNMENT_REVIEW.md](docs/ALIGNMENT_REVIEW.md).

---

## Getting started

### Requirements

- Node.js 22+
- npm
- PostgreSQL
- A configured `DATABASE_URL`

### Install

```bash
npm ci
```

### Configure

Copy the example environment file:

```bash
cp .env.example .env
```

At minimum, configure the application database and initial administrator credentials. Production secrets belong in Railway or the approved secret store, not in Git.

### Development

```bash
npm run dev
```

### Build

```bash
npm run build
```

The build generates Prisma client code, compiles the TypeScript backend and builds the React workspace.

---

## Quality gates

The repository has extensive regression checks. The main aggregate gate is:

```bash
npm run check:all
```

Important individual checks include:

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
npm run check:enterprise
npm run check:react
npm audit --audit-level=high
```

CI runs the repository's release checks automatically. A successful deployment is not a substitute for passing the application and security gates.

See [docs/TESTING.md](docs/TESTING.md) for the testing model and [docs/PRODUCTION_RELEASE_RUNBOOK.md](docs/PRODUCTION_RELEASE_RUNBOOK.md) for the release process.

---

## Deployment

Railway uses the checked-in `railway.json` and Railpack.

The deployment sequence is:

1. **Build** — `npm run build`
2. **Pre-deploy database step** — `npm run db:deploy`
3. **Start** — `npm start`

The web start command does not run a database schema operation. Database deployment is kept as an explicit pre-deploy step so application health checks are not blocked by schema work.

A Dockerfile is also available for other container platforms.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [docs/PRODUCTION_RELEASE_RUNBOOK.md](docs/PRODUCTION_RELEASE_RUNBOOK.md).

---

## Important route model

| Route | Purpose | Status |
|---|---|---|
| `/` | Public enterprise landing page | Current |
| `/login` | Authentication | Current |
| `/dashboard` | Canonical production dashboard | Current visual source of truth |
| `/react/dashboard` | React migration dashboard | Migration workspace |
| `/admin` | Administration console | Current |
| `/users` | User administration | Current |
| `/health` | Deployment health check | Current |
| `/version` | Application/version metadata | Current |

The React route is deliberately documented separately. It should not be described as the production dashboard until visual, functional, responsive and regression checks establish parity with the canonical dashboard.

---

## Channel partners and branding

Channel partners are configured inside the portal and can have their own:

- display name
- logo
- primary colour
- accent colour
- navy/deep brand colour
- tagline
- assigned users
- assigned employers

Users without a partner receive the default empower-fin theme. Partner users receive the configured partner theme.

Partner branding is implemented through the existing BrandEngine and theme-token model. It is not a reason to replace the established dashboard visual language with a generic dashboard design.

---

## Scheduled reports

Administrators configure SMTP and reporting under **Administration > System Email & Scheduled Reports**.

Employer users can schedule reports with:

- reporting window
- site and income filters
- once/daily/weekly/monthly frequency
- send time
- timezone
- saved delivery state
- send-now support

Schedules and delivery logs are stored in PostgreSQL and survive application restarts and deployments.

See [docs/SCHEDULED_REPORTS.md](docs/SCHEDULED_REPORTS.md).

---

## Synthetic test data

The application has an administrator-controlled synthetic-data mode.

When enabled, the dashboard visibly identifies its figures as synthetic test data. This is intended for controlled testing and demonstration; synthetic figures must not be treated as factual customer, financial or operational data.

The setting defaults to **off**.

---

## Documentation

Start with the documentation index:

**[Documentation home →](docs/README.md)**

Key documents:

- [Architecture](docs/ARCHITECTURE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Testing and quality gates](docs/TESTING.md)
- [Scheduled reports](docs/SCHEDULED_REPORTS.md)
- [Date/filter semantics](docs/DATE_FILTER_SEMANTICS.md)
- [Production release runbook](docs/PRODUCTION_RELEASE_RUNBOOK.md)
- [Security policy](SECURITY.md)
- [Security assessment](SECURITY_ASSESSMENT.md)
- [Production readiness](PRODUCTION_READINESS.md)
- [South Africa compliance notes](SOUTH_AFRICA_COMPLIANCE.md)
- [Enterprise portal standard](docs/ENTERPRISE_PORTAL_STANDARD.md)
- [Optimise integration specification](docs/OPTIMISE_INTEGRATION_SPEC_V2.md)

---

## Repository structure

```text
.
├── frontend/        React migration workspace
├── public/          canonical web pages and dashboard assets
├── src/             Fastify server and application services
├── prisma/          schema and database migrations
├── scripts/         deployment and regression checks
├── tests/           contract and service tests
├── docs/            architecture, operations and integration documentation
├── deploy/          alternate container deployment assets
├── .github/         CI and repository automation
├── railway.json     Railway deployment configuration
├── package.json     application scripts and dependencies
└── README.md        repository landing page
```

---

## Release discipline

Production changes should be made through a pull request branch.

Before merge:

1. Review the diff and affected routes.
2. Run the relevant regression checks.
3. Run the complete release gate when the change is production-facing.
4. Test desktop, tablet, phone portrait and phone landscape for UI changes.
5. Verify real data behaviour separately from synthetic/demo data.
6. Confirm Railway deployment and post-deploy health.
7. Retain release evidence for important reporting, security and recovery checks.

Do not merge a migration or visual replacement merely because the code compiles. The canonical dashboard's established visual behaviour remains a protected reference while the React migration is developed.

---

## Security

Never commit:

- production credentials
- database passwords
- API tokens
- session cookies
- customer personal data
- private source-system credentials

Use [SECURITY.md](SECURITY.md) for vulnerability reporting and the production security baseline.

---

## Current documentation principle

Documentation should describe the repository **as it exists**, not as a proposed future architecture.

When behaviour changes:

- update the relevant document in the same pull request;
- update the repository README when the change affects how users/developers understand the system;
- remove stale claims rather than adding another contradictory note;
- record release-critical changes in the appropriate operational document.

This keeps the GitHub repository itself useful as the project's source of truth.
