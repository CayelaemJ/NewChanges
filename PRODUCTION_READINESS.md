# Enterprise production-readiness pass

## What changed

- Added a unified enterprise UI layer (`public/enterprise-v3.css`) without replacing the existing brand-token model. Administrator colours and partner white-label overrides remain the source of truth.
- Added a public enterprise landing page at `/` with an above-the-fold CTA, responsive layout, accessible navigation and a mobile sticky CTA.
- Unauthenticated `/` now serves the landing page; authenticated dashboard users still go directly to `/dashboard`.
- Added `/` to the generated sitemap.
- Kept the existing custom 404, legal pages, thank-you flow, favicon set, OG image, responsive breakpoints, loading states, form validation/error states and first-party engagement analytics.
- Removed legal-page placeholder values for date/company/address and documented the real public business address currently published by Empower Financial Services. Confirm legal ownership before production launch.
- Fixed the session-cookie behaviour so an unchecked “Remember me” produces a session cookie instead of a 30-day persistent cookie.
- Tightened cookie-authenticated state-changing requests to require same-origin evidence when a session cookie is present; bearer-token clients remain supported.
- Added additional defensive HTTP headers and immutable caching for static image/font assets.
- Corrected the password-setup UI so it matches the enforced 12-character, upper/lower/number policy.
- Added a deterministic production-readiness audit script.

## Verification performed

- `node --check` passes for all JavaScript and `.mjs` files in the repository.
- `npm run check:production` passes the static production-readiness audit.
- Full TypeScript build could not be executed in this environment because the repository dependencies could not be installed before the execution timeout. The source tree therefore still requires `npm ci && npm run build` in the deployment/CI environment before release.

## Final release gate

Do not call the application production-ready until CI successfully runs:

1. `npm ci`
2. `npm run build`
3. `npm run check:production`
4. `npm run check:security`
5. `npm run check:ui`
6. `npm run check:imports`
7. `npm run check:scheduling`
8. `npm audit --audit-level=high`

Also configure real production values for `PUBLIC_BASE_URL`, `CONTACT_EMAIL`, privacy/legal contacts, SMTP credentials and database credentials. Legal text should be reviewed by the organisation's legal/privacy owner before launch.
