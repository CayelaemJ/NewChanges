# Current status

**Repository:** `CayelaemJ/NewChanges`  
**Version:** `0.10.0`  
**Last reviewed:** 5 October 2026

## Production route

The canonical production dashboard is:

```text
/dashboard
```

It currently uses the established `public/dashboard.html` implementation.

This is deliberate. Recent changes restored the original dashboard as the canonical production visual after the React route caused a production white-screen/regression sequence.

## React migration

The React implementation is available at:

```text
/react/dashboard
```

It remains a migration workspace.

The React implementation should not replace `/dashboard` until all of the following are demonstrated:

- functional parity;
- visual parity with the established dashboard;
- correct dark mode;
- correct BrandEngine behaviour;
- correct gauge;
- correct Executive Insight;
- correct charts and comparisons;
- desktop/tablet/phone/landscape verification;
- regression suite success.

## Recent production-facing fixes

Recent merged work includes:

- restoration of the original dashboard as canonical `/dashboard`;
- restoration of the live wellness gauge on the actual production route;
- restoration of the default dashboard palette for Admin/Super Admin;
- restoration of the default admin dashboard theme;
- continued separation of React migration work from the canonical production route.

An open PR currently adds an authenticated dashboard role indicator for Admin/Super Admin users. It is not part of this documentation change.

## MLOps

The merged MLOps platform provides governed telemetry and model lifecycle controls.

Incoming data-quality guardrails are also present in the current codebase and are invoked by import and external sync paths.

## Brand Engine

BrandEngine remains active and is part of the current theme/branding architecture.

It is not an optional visual experiment and should not be removed during future UI work.

## Documentation status

This repository now has:

- a repository landing page;
- a documentation index;
- current architecture documentation;
- deployment documentation;
- testing/release-gate documentation;
- scheduled-report documentation;
- a current-status document;
- existing integration, security, compliance and production runbooks.

## Important rule for future changes

When changing a production route, first identify the current source of truth and verify the route served in production.

Do not infer production behaviour from an unused migration component or an alternative route.

When a change affects user-visible behaviour, update the relevant documentation in the same pull request.
