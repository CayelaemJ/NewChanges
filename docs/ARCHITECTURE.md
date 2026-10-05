# Architecture

## System overview

The portal is a Node.js/TypeScript application using Fastify for HTTP, Prisma for persistence and PostgreSQL for application data.

The frontend is currently a controlled hybrid:

- the established production dashboard is served from `public/dashboard.html`;
- the React migration is built from `frontend/` and exposed at `/react/dashboard`;
- administration and supporting pages remain available through the established public HTML surfaces while React migration work continues.

This is intentional. The React migration must not silently replace the canonical production UI before parity and regression verification are complete.

## Request flow

```text
Browser
  |
  v
Fastify server
  |
  +--> auth/session checks
  +--> role/module checks
  +--> public HTML/static assets
  +--> dashboard/report APIs
  +--> administration APIs
  +--> integration/import APIs
  +--> MLOps governance APIs
  |
  v
Service layer
  |
  +--> dashboard/report calculations
  +--> source contract validation
  +--> import/sync services
  +--> BrandEngine/theme services
  +--> reporting scheduler
  +--> audit/security services
  +--> MLOps services
  |
  v
Prisma/PostgreSQL
```

## Data ingestion

The application accepts three core ingestion paths:

1. HTTPS/API pulls
2. Direct read-only SQL views
3. CSV/XLSX/JSON imports

All core paths converge on contract validation and data-quality controls before live data is written.

External SQL credentials remain server-side.

## Data-quality gate

Incoming data is assessed before live-table writes.

The guardrail layer can identify issues such as:

- non-finite values;
- suspicious negative financial/count values;
- robust outliers;
- missingness spikes;
- extreme distribution shifts;
- other contract or quality failures.

When a batch is blocked, suspicious staged rows are quarantined/removed from the live write path and the decision is recorded in MLOps telemetry.

The relevant regression checks are:

- `npm run check:mlops`
- `npm run check:mlops-data-quality`

## Reporting model

The portal separates:

- event dates;
- effective/observation dates;
- technical source-change timestamps.

Stock metrics are calculated as at the selected reporting end. Flow metrics are calculated within the selected reporting window.

This prevents a current mutable record from being projected backwards into historical reporting.

See [DATE_FILTER_SEMANTICS.md](DATE_FILTER_SEMANTICS.md) for the complete model.

## Brand and theme model

Branding is handled by the existing BrandEngine and partner theme model.

The engine derives:

- accent colour;
- primary/secondary brand colour;
- navy/deep brand colour;
- chart palette;
- contrast-safe values;
- confidence and warning information.

Dark mode is token-driven. Partner branding is applied through the theme controller rather than by replacing the application with a generic visual system.

## Roles and access

Access is enforced server-side. UI visibility is not the security boundary.

The application distinguishes ordinary users from privileged administrative roles and applies module-level access checks before protected resources are returned.

Channel partners are represented as a separate configuration layer. Their users can receive partner branding and employer assignments without changing the underlying source contract.

## Frontend migration model

### Canonical production route

`/dashboard` continues to use `public/dashboard.html`.

This protects the established production visual while React work is evaluated independently.

### React route

`/react/dashboard` is the React migration workspace.

It uses the frontend project under `frontend/` and includes the current Tailwind utility layer and selective MUI usage.

The React route must not be described as production-equivalent until:

- functional parity is demonstrated;
- visual parity is reviewed;
- desktop/tablet/mobile/landscape checks pass;
- dark mode remains correct;
- BrandEngine behaviour remains correct;
- gauge, Executive Insight, charts and comparisons are verified;
- regression checks pass.

## Deployment topology

Railway is the primary deployment target.

```text
Railway
  |
  +--> build: npm run build
  +--> pre-deploy: npm run db:deploy
  +--> start: npm start
  |
  v
Fastify application + PostgreSQL
```

Database deployment is explicit and separate from application startup.

## Important operational principle

The repository contains both legacy/established surfaces and newer React infrastructure. Do not assume the newest implementation is automatically the production source of truth.

Before changing a route, identify:

1. which route production actually serves;
2. which file owns the current visual;
3. which API/data contract it consumes;
4. which regression checks protect it;
5. whether the proposed change is intended for production or migration work.

That distinction prevents the type of route/visual regression that occurred during the earlier React migration work.
