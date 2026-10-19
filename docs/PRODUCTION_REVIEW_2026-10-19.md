# NewChanges production review — 19 October 2026

## Verified fixes

- Block direct public static HTML, source maps and dotfiles. Canonical protected routes remain available after sign-in.
- Require authentication and the appropriate module permission for React dashboard/admin entry routes.
- Return only user ID and partner ID from partner assignments instead of serializing the full user identity record. Revoke affected sessions before changing partner scope.
- Remove request query strings from application request logging, including reset-link tokens. Password setup pages use a no-referrer policy.
- Reduce the anonymous version endpoint to product and version.
- Prevent the portfolio from rendering its eight built-in fixtures while live data loads. Loading, failed requests and stale responses cannot present those fixtures as authorised employer data. Repaint a visible portfolio after completion and bound the request time.
- Correct dashboard prose containing accidental “Not available” substitutions while preserving missing metric values.
- Exclude future/invalid reporting months on both server and browser; preserve null scores as unavailable instead of coercing them to zero.
- Show an actionable React empty-access state instead of an indefinite loading indicator.
- Replace the login page's invalid placeholder mailto link with the contact route.
- Commit the frontend dependency lock and use npm ci for frontend builds and CI installs.

## Validation

- Backend TypeScript compile, React production build and frontend typecheck passed.
- ESLint and Vitest passed (2 existing quality tests).
- 24 existing static regression commands passed, including UI, security, accessibility, production readiness, imports and scheduling.
- Brand engine passed 245 assertions. Source contract passed for 10 reports and 10 sample feeds. React migration checks passed 22 checks.
- Semantic planner/storage, source vault, cutover continuity and reconciliation tests passed using node --import tsx (the tsx CLI's IPC socket is unavailable in this runner).
- New Fastify injection tests passed for anonymous API rejection, protected page redirects, static document/source-map denial, security/cache headers and cross-origin cookie mutation rejection. Tests use an isolated dummy database URL and do not run schedulers.
- New dashboard behaviour tests passed for portfolio pending/success/failure/stale responses, malformed/future period rejection, and null score display.
- All public HTML inline scripts parsed successfully.
- Dependency audit: backend has 0 high/critical findings (4 moderate, 1 low); frontend has 0 findings at review time.

## Release status and remaining gates

This change is a reviewed hardening pass, not a certification that every workflow is defect-free or that the application is immune to attack.

The supplied Render deployment was inspected and sign-in succeeded. It displayed synthetic test data, a last-sync date of 16 October, an in-progress source operation, and workforce reconciliation warnings (snapshot denominator 692 vs dated detail 695 for the selected employer). Those notices must not be hidden to imply production data is ready. Validate the approved source and reconcile data before real reporting goes live; do not purge the shared database as part of this UI release.

The existing script CSP still permits unsafe-inline for legacy event handlers. A stricter CSP requires migrating those handlers and verifying all pages. Role-matrix browser testing, responsive/visual checks of the deployed patch, authenticated mutations in a disposable environment, and a broader security scan remain required. Existing Vitest coverage is narrow; its 2 passing tests are not full application coverage.

The release must pass remote CI and deployment verification before merge/promotion. Confirm the Render workspace and intended service, inspect its deployed commit, backups, readiness configuration, source-leader/scheduler settings and production variables, then verify the candidate in the browser. No production data writes, reset/rebuild, or infrastructure configuration changes were performed during this review.

F12 will always reveal browser HTML, CSS, JavaScript and authorised API responses. Protection comes from server permissions and keeping credentials/secret records out of responses, not disabling developer tools. The password supplied in chat should be rotated through the normal account flow.
