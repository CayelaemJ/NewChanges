# NewChanges — comprehensive change log

> **Updated:** 12 October 2026  |  **Repository:** [CayelaemJ/NewChanges](https://github.com/CayelaemJ/NewChanges)  |  **History covered:** PR #1 through PR #89 (all 82 PR records returned by GitHub).

This document is a chronological audit trail of **proposed and merged pull requests**, not a claim that every PR was deployed or production-verified. **Merged** means incorporated in the repository; **Closed, not merged** means the proposal was not incorporated through that PR; **Open** means still proposed. A merge alone does not certify a successful Railway deployment, completed source refresh, or production readiness. The current project version shown in previous documentation was **0.10.0**; PR numbers are not semantic versions.

## Executive history

1. **File ingestion and reliable builds:** From TypeScript fixes through chunked CSV/Excel/JSON import, deferred validation, row progress and SQL source diagnostics.
2. **Dashboard and financial semantics:** Fixed period filters, last-available-month comparisons, recurring savings and EWA run-rate meaning, responsive financial values, dashboard cache and wellness gauge.
3. **Branding and access control:** Evolved partner/logo colour analysis into Brand Engine, protected admin/superadmin branding, repaired Viewer partner-theme precedence and introduced default The Fixer styling.
4. **Security and governance:** Added identity/session telemetry, audit exports, privacy governance workflows, production release documentation and enterprise operations controls.
5. **Enterprise integration and MLOps:** Added governed file/API/SQL ingestion, SQL read-replica options, MLOps model/data monitoring, reset/rebuild corrections and EWA upsert repairs.
6. **React transition:** Tested React on the canonical route, addressed rendering regressions and then deliberately restored the established production dashboard as canonical while continuing React on a separate route.

## Current implementation and verification notes

- **Canonical user experience:** `/dashboard` is the established dashboard; `/react/dashboard` is a separate React workstream per merged PR #68. Do not describe the entire migration as completed.
- **Source of truth:** The connected MySQL/SQL or API source is distinct from the application's PostgreSQL read model. The reset/rebuild and source-sync history includes several production-impacting incident fixes.
- **Quality guardrails:** MLOps was merged in PR #62 and refined in PR #81, but the separate proposal in PR #63 was closed without merging; evaluate effective guardrails from code and tests, not just PR descriptions.
- **Deployment:** GitHub merge state is separate from Railway deployment health. Recent predeploy/sync incidents include SQL bulk upsert failures and incomplete source refreshes.
- **Open dependency PRs:** Their proposed package versions must not be described as dependencies already running in production.

## Complete pull-request ledger

### October 2026: live dashboard recovery, branding and source reliability (PR #70–#89)

#### [PR #89: deps: bump the npm-production group across 1 directory with 10 updates](https://github.com/CayelaemJ/NewChanges/pull/89) — Open

Proposed grouped npm production dependency bumps. Open, not yet merged.

#### [PR #88: Remove The Fixer attribution from custom partner UI](https://github.com/CayelaemJ/NewChanges/pull/88) — Merged

Removed The Fixer attribution from custom partner-branded views without affecting default Admin/Super Admin branding.

#### [PR #87: Align default NewChanges UI with The Fixer brand](https://github.com/CayelaemJ/NewChanges/pull/87) — Merged

Applied The Fixer default identity across default portal pages and React fallbacks while keeping partner-specific overrides.

#### [PR #86: deps: bump node from 22-slim to 25-slim](https://github.com/CayelaemJ/NewChanges/pull/86) — Open

Bumps node from 22-slim to 25-slim. [](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updatesabout-compatibility-scores) Dependabot will resolve any conflicts with this PR as long as you don't.

#### [PR #85: Fix Viewer channel-partner theme being overwritten on dashboard](https://github.com/CayelaemJ/NewChanges/pull/85) — Merged

Fixed live employer-dashboard payload theme precedence so a Viewer keeps assigned channel-partner branding.

#### [PR #84: Fix viewer channel partner branding in employer dashboard](https://github.com/CayelaemJ/NewChanges/pull/84) — Merged

Corrected partner-specific logo handling in the React Viewer dashboard.

#### [PR #83: Fix EWA predeploy SalaryAdvance id generation](https://github.com/CayelaemJ/NewChanges/pull/83) — Merged

Added deterministic internal SalaryAdvance IDs for raw SQL inserts to correct a predeploy NOT NULL failure.

#### [PR #82: Fix Early Wage Access duplicate advanceRef upserts](https://github.com/CayelaemJ/NewChanges/pull/82) — Merged

Changed Early Wage Access bulk synchronisation to upsert by unique advanceRef instead of internal ID.

#### [PR #81: Fix MLOps false positives for bounded rating fields](https://github.com/CayelaemJ/NewChanges/pull/81) — Merged

Made MLOps checks aware of bounded ordinal ratings, avoiding inappropriate outlier/drift detection on 1–5 star fields.

#### [PR #80: fix: make reset rebuild from the full connected source](https://github.com/CayelaemJ/NewChanges/pull/80) — Merged

Corrected Reset & Rebuild extraction so full source reloads are not inadvertently constrained by an upper timestamp window.

#### [PR #79: hotfix: keep Admin and Superadmin on empower-fin branding](https://github.com/CayelaemJ/NewChanges/pull/79) — Merged

Stopped the employer-selected ABSA theme from overriding Admin and Super Admin default branding.

#### [PR #78: feat: improve dashboard freshness and mobile responsiveness](https://github.com/CayelaemJ/NewChanges/pull/78) — Merged

Improved dashboard sync freshness labels, mobile/tablet layouts and related responsive presentation.

#### [PR #77: hotfix: restore dashboard rendering after executive insight fix](https://github.com/CayelaemJ/NewChanges/pull/77) — Merged

Moved Executive Insight CSS into the correct style block to restore Dashboard execution.

#### [PR #76: fix: improve dashboard executive insight contrast](https://github.com/CayelaemJ/NewChanges/pull/76) — Merged

Changed Executive Insight readability, but its initial stylesheet placement introduced a dashboard JavaScript regression.

#### [PR #75: docs: establish current repository documentation](https://github.com/CayelaemJ/NewChanges/pull/75) — Merged

Rebuilt repository documentation, architecture, deployment/testing guides and initial changelog.

#### [PR #74: feat: show admin role indicator on dashboard](https://github.com/CayelaemJ/NewChanges/pull/74) — Merged

- Show ADMIN or ★ SUPER ADMIN in the Dashboard top bar based on the authenticated role. - Keep the indicator hidden for ordinary users. - Preserve the default blue/navy Admin Dashboard theme from the existing PR branch. - No Admin or Users.

#### [PR #73: fix: restore default dashboard theme for admins](https://github.com/CayelaemJ/NewChanges/pull/73) — Merged

Prevented privileged-dashboard theme overrides.

#### [PR #72: fix: restore live dashboard wellness gauge](https://github.com/CayelaemJ/NewChanges/pull/72) — Merged

Corrected live dashboard wellness gauge gradient and SVG path-length scaling.

#### [PR #71: fix: restore default dashboard colours for Admin and Super Admin](https://github.com/CayelaemJ/NewChanges/pull/71) — Merged

Restore the standard empower-fin dashboard colour palette on the Administration Console. - Removes the green/grey admin-specific base palette. - Uses the same default purple/navy brand palette as the dashboard. - Keeps semantic.

#### [PR #70: fix: restore wellness gauge rendering](https://github.com/CayelaemJ/NewChanges/pull/70) — Merged

Corrected React-side gauge arc scaling, separate from the canonical dashboard.

### Enterprise data operations, governance and React route work (PR #51–#69)

#### [PR #69: deps: bump the npm-production group across 1 directory with 8 updates](https://github.com/CayelaemJ/NewChanges/pull/69) — Closed, not merged

Bumps the npm-production group with 8 updates in the / directory: Package From To --- --- --- @prisma/client 5.22.0 7.10.0 @types/node 22.19.19 26.6.4 mssql 11.0.1 12.7.4 mysql2 3.24.2 3.24.5 nodemailer 10.0.12 10.0.15 pg 8.23.0 8.23.1.

#### [PR #68: Restore original dashboard visual as canonical /dashboard](https://github.com/CayelaemJ/NewChanges/pull/68) — Merged

Restored legacy /dashboard as the production visual source of truth while React remains at /react/dashboard.

#### [PR #67: Fix React dashboard white screen](https://github.com/CayelaemJ/NewChanges/pull/67) — Merged

Addressed an initial React dashboard white-screen caused during the route transition.

#### [PR #66: deps: bump the npm-production group across 1 directory with 7 updates](https://github.com/CayelaemJ/NewChanges/pull/66) — Closed, not merged

Bumps the npm-production group with 7 updates in the / directory: Package From To --- --- --- @prisma/client 5.22.0 7.10.0 @types/node 22.19.19 26.6.3 mssql 11.0.1 12.7.2 mysql2 3.24.2 3.24.5 nodemailer 10.0.12 10.0.13 prisma 5.22.0 7.10.0.

#### [PR #65: Fix canonical dashboard route to use React frontend](https://github.com/CayelaemJ/NewChanges/pull/65) — Merged

Routed canonical /dashboard to React temporarily while preserving authenticated access.

#### [PR #64: deps: bump the npm-development group across 1 directory with 2 updates](https://github.com/CayelaemJ/NewChanges/pull/64) — Open

Bumps the npm-development group with 2 updates in the / directory: @types/luxon and tsx. Updates @types/luxon from 3.7.5 to 3.7.6 Updates tsx from 4.22.4 to.

#### [PR #63: Harden MLOps with incoming data anomaly guardrails](https://github.com/CayelaemJ/NewChanges/pull/63) — Closed, not merged

Proposed quarantine-first incoming data quality gates. Closed without merge; do not assume this proposal shipped independently.

#### [PR #62: Complete brand learning and add governed MLOps platform](https://github.com/CayelaemJ/NewChanges/pull/62) — Merged

Added the governed MLOps foundation for data quality, drift, anomaly detection, forecasts, observability, human feedback and model lifecycle/brand learning.

#### [PR #61: Upgrade brand colour recognition with ML Ops telemetry](https://github.com/CayelaemJ/NewChanges/pull/61) — Closed, not merged

Proposed versioned Brand Engine confidence, diagnostics and health telemetry. Closed without merge; not listed as released.

#### [PR #60: Add admin toggle for synthetic test data disclaimer](https://github.com/CayelaemJ/NewChanges/pull/60) — Merged

Introduced a persistent admin-controlled synthetic-data disclaimer shown on Dashboard.

#### [PR #59: deps: bump esbuild from 0.28.0 to 0.28.2 in the npm-security group across 1 directory](https://github.com/CayelaemJ/NewChanges/pull/59) — Open

Bumps the npm-security group with 1 update in the / directory: esbuild. Updates esbuild from 0.28.0 to.

#### [PR #58: fix: restore admin console runtime](https://github.com/CayelaemJ/NewChanges/pull/58) — Merged

- fix the admin console parse failure caused by a duplicate const replica declaration - remove three stale stylesheet references that return HTML instead of CSS because those superseded files were removed Evidence Browser console reported:.

#### [PR #57: fix: restore dashboard after PR 56 syntax regression](https://github.com/CayelaemJ/NewChanges/pull/57) — Merged

PR 56 introduced the intended chart label fix, but the edit accidentally committed literal "\\n" sequences into the JavaScript source instead of real line breaks. That makes the dashboard script fail to parse, so dashboard content does not.

#### [PR #56: fix: keep financial comparison labels inside dashboard cards](https://github.com/CayelaemJ/NewChanges/pull/56) — Merged

The month-to-date financial comparison charts can render the current period label, such as "September 2026 (month to date)", beyond the right edge of the SVG/card. This change: - anchors the first period label to the left plot edge -.

#### [PR #55: feat: harden admin realtime jobs and data loading](https://github.com/CayelaemJ/NewChanges/pull/55) — Merged

Fixed Admin boot timing and loading states; hardened live jobs and data-load visibility.

#### [PR #54: fix: restore admin report selector](https://github.com/CayelaemJ/NewChanges/pull/54) — Merged

The Reports selector was not actually removed from the backend. The endpoint returns HTTP 200, but the admin page crashed while rendering the response because the esc() HTML escaping helper was missing. That caused the catch block to.

#### [PR #53: feat: restore unified data ingestion centre](https://github.com/CayelaemJ/NewChanges/pull/53) — Merged

Restored clearly selectable file, API and SQL ingestion paths, including MySQL/MariaDB, PostgreSQL and SQL Server.

#### [PR #52: feat: enterprise analytics source replica routing](https://github.com/CayelaemJ/NewChanges/pull/52) — Merged

Added optional source replica routing, read-only workload classification, replica health, lag monitoring and administrator configuration.

#### [PR #51: feat: enterprise operations and governed analytics routing](https://github.com/CayelaemJ/NewChanges/pull/51) — Merged

Created Enterprise Operations and governed analytics routing between PostgreSQL read models, source aggregates and hybrid placement.

### Security, compliance, analytics and dependency maintenance (PR #28–#50)

#### [PR #50: deps: bump the npm-production group across 1 directory with 6 updates](https://github.com/CayelaemJ/NewChanges/pull/50) — Closed, not merged

Bumps the npm-production group with 6 updates in the / directory: Package From To --- --- --- @prisma/client 5.22.0 7.10.0 @types/node 22.19.19 26.6.3 mssql 11.0.1 12.7.2 mysql2 3.24.2 3.24.5 prisma 5.22.0 7.10.0 typescript 5.9.3 7.0.2.

#### [PR #49: deps: bump tsx from 4.22.4 to 4.23.15 in the npm-development group across 1 directory](https://github.com/CayelaemJ/NewChanges/pull/49) — Closed, not merged

Bumps the npm-development group with 1 update in the / directory: tsx. Updates tsx from 4.22.4 to.

#### [PR #48: deps: bump node from 22-slim to 25-slim](https://github.com/CayelaemJ/NewChanges/pull/48) — Closed, not merged

Bumps node from 22-slim to.

#### [PR #47: deps: bump the github-actions group across 1 directory with 2 updates](https://github.com/CayelaemJ/NewChanges/pull/47) — Open

Bumps the github-actions group with 2 updates in the / directory: actions/checkout and actions/setup-node. Updates actions/checkout from 4 to 7 Updates actions/setup-node from 4 to.

#### [PR #46: chore: automate daily dependency upgrades](https://github.com/CayelaemJ/NewChanges/pull/46) — Merged

What this does - Adds Dependabot coverage for npm packages, Docker base images, and GitHub Actions. - Checks every day at 00:00 South Africa time using Africa/Johannesburg. - Groups npm production and development upgrades to keep review.

#### [PR #45: feat: add South Africa privacy, cyber security and data governance controls](https://github.com/CayelaemJ/NewChanges/pull/45) — Merged

Added South African privacy/cyber governance workflows covering processing records and data-subject requests; these are operational controls, not a legal compliance certification.

#### [PR #44: feat: strengthen security operations, data governance and audit controls](https://github.com/CayelaemJ/NewChanges/pull/44) — Merged

Expanded sensitive-access and security audit views with exportable administrative and authentication evidence.

#### [PR #43: Add enterprise Security & Identity Center and richer Users admin](https://github.com/CayelaemJ/NewChanges/pull/43) — Merged

Introduced security/identity monitoring, session and login history, administrative session revocation, user security views and alerting.

#### [PR #42: Fix 1000x formatting on month financial comparison values](https://github.com/CayelaemJ/NewChanges/pull/42) — Merged

Fixed a thousandfold currency presentation error in financial comparison cards.

#### [PR #41: Make financial chart values responsive across desktop tablet and mobile](https://github.com/CayelaemJ/NewChanges/pull/41) — Merged

Moved full monetary values to responsive chart cards so axes remain readable on desktop and mobile.

#### [PR #40: Restore legacy month run-rate chart behaviour](https://github.com/CayelaemJ/NewChanges/pull/40) — Merged

Restored original business meaning: cumulative recurring savings run-rate and monthly finalised wage-advance run-rate.

#### [PR #39: Fix stale dashboard cache for month financial comparisons](https://github.com/CayelaemJ/NewChanges/pull/39) — Merged

Versioned persistent dashboard cache to invalidate old financial comparison payloads.

#### [PR #38: Make month financial charts always render current vs previous month](https://github.com/CayelaemJ/NewChanges/pull/38) — Closed, not merged

es the remaining month-chart defect. When a month/latest period is active, Monthly Cash Freed Up and Total Advanced per Month now always construct exactly two financial points from the current period and the prior-period totals, even if.

#### [PR #37: Fix month-to-month financial chart comparisons and axis layout](https://github.com/CayelaemJ/NewChanges/pull/37) — Merged

Corrected month-over-month chart values, explicit previous-month comparisons and Y-axis spacing.

#### [PR #36: Enterprise mobile ratings and intelligent brand visuals](https://github.com/CayelaemJ/NewChanges/pull/36) — Merged

Improved mobile Value Delivered panels, real average/half-star ratings, Brand Engine colour rendering and palette regression coverage.

#### [PR #35: build(deps): bump mysql2 from 3.24.2 to 3.24.4](https://github.com/CayelaemJ/NewChanges/pull/35) — Closed, not merged

Bumps mysql2 from 3.24.2 to 3.24.4. [](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updatesabout-compatibility-scores) Dependabot will resolve any conflicts with this PR as long as you don't.

#### [PR #34: build(deps): bump @types/node from 22.19.19 to 26.6.3](https://github.com/CayelaemJ/NewChanges/pull/34) — Closed, not merged

Bumps @types/node from 22.19.19 to 26.6.3. [](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updatesabout-compatibility-scores) Dependabot will resolve any conflicts with this PR as long as.

#### [PR #33: build(deps): bump @prisma/client from 5.22.0 to 7.10.0](https://github.com/CayelaemJ/NewChanges/pull/33) — Closed, not merged

Bumps @prisma/client from 5.22.0 to 7.10.0. [](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updatesabout-compatibility-scores) Dependabot will resolve any conflicts with this PR as long as.

#### [PR #32: deps: bump mssql and @types/mssql](https://github.com/CayelaemJ/NewChanges/pull/32) — Open

Bumps mssql and @types/mssql. These dependencies needed to be updated together. Updates mssql from 11.0.1 to 12.7.2 Updates @types/mssql from 9.1.11 to.

#### [PR #31: build(deps): bump prisma from 5.22.0 to 7.10.0](https://github.com/CayelaemJ/NewChanges/pull/31) — Closed, not merged

Bumps prisma from 5.22.0 to 7.10.0. [](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updatesabout-compatibility-scores) Dependabot will resolve any conflicts with this PR as long as you don't.

#### [PR #30: build(deps): bump actions/setup-node from 4 to 7](https://github.com/CayelaemJ/NewChanges/pull/30) — Closed, not merged

Bumps actions/setup-node from 4 to 7. [](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updatesabout-compatibility-scores) Dependabot will resolve any conflicts with this PR as long as you.

#### [PR #29: build(deps): bump actions/checkout from 4 to 7](https://github.com/CayelaemJ/NewChanges/pull/29) — Closed, not merged

Bumps actions/checkout from 4 to 7. [](https://docs.github.com/en/github/managing-security-vulnerabilities/about-dependabot-security-updatesabout-compatibility-scores) Dependabot will resolve any conflicts with this PR as long as you don't.

#### [PR #28: Production hardening, governance, mobile cleanup, and score regression gates](https://github.com/CayelaemJ/NewChanges/pull/28) — Merged

Introduced production governance/release controls, security hardening, regression gates and mobile clean-up, including protection against unsafe external API destinations.

### Foundation: imports, initial syncing, branding and deployment (PR #1–#27)

#### [PR #27: Fix: regenerate package-lock.json to match updated dependencies](https://github.com/CayelaemJ/NewChanges/pull/27) — Merged

The build was failing with an npm ci error because package-lock.json was out of sync with package.json. Build logs showed: - csv-parse@5.6.0 does not satisfy csv-parse@7.0.3 - node-cron@4.6.0 missing from lock file - nodemailer@7.0.13 does.

#### [PR #26: Add detailed sync logging to debug zero records issue](https://github.com/CayelaemJ/NewChanges/pull/26) — Merged

Sync is returning 0 records even though the underlying MySQL views exist and contain data, and the config/connection have been verified. To diagnose without guessing, added timestamped console.log statements throughout.

#### [PR #25: Fix first sync to load all records without date filtering](https://github.com/CayelaemJ/NewChanges/pull/25) — Merged

Made the initial SQL source sync explicitly unfiltered by incremental cursors.

#### [PR #24: Railway Deployment #dadea9 fix: remove duplicate ok key](https://github.com/CayelaemJ/NewChanges/pull/24) — Merged

TypeScript build failed with TS2783 in src/services/dailyRefresh.ts because triggerRefreshNow() returned { ok: true, ...result } where result already contains an ok property from both refreshViaDbProcedure() and refreshViaAppPipeline(),.

#### [PR #23: Railway Deployment #29f18b fix: map renamed Partner color fields](https://github.com/CayelaemJ/NewChanges/pull/23) — Merged

Pre-deploy failed because prisma/schema.prisma renamed Partner.primaryColor/accentColor/navyColor to primaryBrandColor/secondaryColor/dominantBackgroundColor without preserving the underlying column names. Prisma db push saw this as.

#### [PR #22: Fix users logout bug, add logo color detection, improve admin UI](https://github.com/CayelaemJ/NewChanges/pull/22) — Merged

Fixed cookie credentials in Users API calls, improved partner logo colour detection and redesigned the Admin partner editor.

#### [PR #21: Railway Deployment #28797f fix: preserve Partner color columns](https://github.com/CayelaemJ/NewChanges/pull/21) — Merged

Mapped renamed Prisma theme fields to existing database columns to prevent destructive schema drift during Railway predeploy.

#### [PR #20: Fix admin branding & add logo color analysis](https://github.com/CayelaemJ/NewChanges/pull/20) — Merged

Corrected administrator theme selection; added logo colour analysis and renamed partner theme fields into primary, secondary and background concepts.

#### [PR #19: Update server.ts](https://github.com/CayelaemJ/NewChanges/pull/19) — Merged

Repository PR description does not document the implementation details; consult the linked diff before making stronger claims.

#### [PR #18: Update importService.ts](https://github.com/CayelaemJ/NewChanges/pull/18) — Closed, not merged

Repository PR description does not document the implementation details; consult the linked diff before making stronger claims.

#### [PR #17: Update package.json](https://github.com/CayelaemJ/NewChanges/pull/17) — Merged

Repository PR description does not document the implementation details; consult the linked diff before making stronger claims.

#### [PR #16: Railway Deployment #ee6bf0 fix: type CSV export route params](https://github.com/CayelaemJ/NewChanges/pull/16) — Merged

The Railpack build failed during 'npm run build' (tsc) with TS18046 on req.params.batchId and TS2339 on e.message in the /api/admin/batches/:batchId/csv route, because the route was declared without a Fastify route generic, leaving.

#### [PR #8: Merge pull request #7 from CayelaemJ/CayelaemJ-patch-4](https://github.com/CayelaemJ/NewChanges/pull/8) — Merged

Add files via.

#### [PR #7: Add files via upload](https://github.com/CayelaemJ/NewChanges/pull/7) — Merged

Repository PR description does not document the implementation details; consult the linked diff before making stronger claims.

#### [PR #6: Add files via upload](https://github.com/CayelaemJ/NewChanges/pull/6) — Merged

Repository PR description does not document the implementation details; consult the linked diff before making stronger claims.

#### [PR #5: New Patches to fix dashboard](https://github.com/CayelaemJ/NewChanges/pull/5) — Merged

Added the new patches so that we can fix slicers on the dashboard as they were giving.

#### [PR #4: Add files via upload](https://github.com/CayelaemJ/NewChanges/pull/4) — Merged

Repository PR description does not document the implementation details; consult the linked diff before making stronger claims.

#### [PR #3: Optimize imports with deferred validation, progress tracking, and early first-row feedback](https://github.com/CayelaemJ/NewChanges/pull/3) — Merged

Separated early field/business-rule validation from deferred duplicate checks; added rows-processed and first-row-error telemetry for progress reporting.

#### [PR #2: Stream XLSX/JSON imports to handle large files without memory exhaustion](https://github.com/CayelaemJ/NewChanges/pull/2) — Merged

Introduced bounded-chunk ingestion for CSV, XLSX and JSON, retaining preview rows while avoiding unbounded validated-row accumulation; XLSX/JSON parsers still require initial parsing buffers.

#### [PR #1: Fix syntax errors in importService.ts](https://github.com/CayelaemJ/NewChanges/pull/1) — Merged

Repaired invalid Prisma import-batch operations that broke TypeScript compilation and Railway image builds.

## PR numbering and provenance

- GitHub returned 82 pull-request records within #1–#89. Numbers #9–#15 were not returned as pull requests and are **not** represented as verified PRs; GitHub issue and PR numbering may share a sequence.
- The ledger is based on the linked PR titles and descriptions plus observed PR merge/state metadata as of 12 October 2026. For PRs titled only “Add files via upload” or “Update …”, documentation is deliberately conservative because the PR description lacks an auditable change explanation.
- Entries for grouped dependency upgrades describe **proposals** when open or closed without merge. Do not assume installation of proposed major-version upgrades.
- A detailed change list should also be maintained in PR descriptions and complemented by CI reports, merge commits, release tags and Railway deployment evidence for any production release.

## Outstanding validation and release gates

- Verify end-to-end source extraction, each of the 10 governed feed stages, MLOps decisions and dashboard data freshness against a real connected source.
- Exercise reset/rebuild, including empty-read-model and >250,000-row ingestion scenarios, without misreporting accepted rows or advancing failure cursors.
- Confirm protected last-successful dashboard behaviour when ingestion fails, and confirm source/API identity is visible to administrators.
- Check Admin, Super Admin, partner Viewer and employer-facing themes, navigation and role permissions, including server-side enforcement.
- Complete React visual/functional parity and CI gates before changing the canonical dashboard route again.
- Validate disaster recovery, backup restoration, access audit records, data retention and the actual Railway production release configuration.

## Maintenance policy

Update this file whenever a PR changes user-visible behaviour, system architecture, data semantics, security, ingestion, scheduled reporting, ML Ops, infrastructure or deployment. Include the PR link and status, distinguish proposed from released functionality, and record regressions and follow-up fixes rather than rewriting history.
