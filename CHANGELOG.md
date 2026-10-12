# NewChanges — comprehensive change log

> **Updated:** 12 October 2026 (expanded engineering history)  |  **Repository:** [CayelaemJ/NewChanges](https://github.com/CayelaemJ/NewChanges)  |  **History covered:** PR #1 through PR #89 (all 82 PR records returned by GitHub).

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

---

# Technical implementation appendix: detailed PR review

This appendix adds the **source-described implementation rationale** for every discovered pull request, including affected functions, interfaces, data semantics, deployment constraints and fix chains where those details are available. It complements the short chronological ledger above rather than replacing it. The sections below reflect PR descriptions, **not independent execution or deployment validation**. Each entry links to the underlying code review where its exact file-level diff can be inspected.

## PR #1: Fix syntax errors in importService.ts

**Status:** MERGED into repository  
**Source:** [GitHub PR #1](https://github.com/CayelaemJ/NewChanges/pull/1)

### Recorded problem, implementation and test notes

## Problem

Commit 0c2cdc4 accidentally deleted the `prisma` reference and `await` keyword on two lines in src/services/importService.ts, leaving bare-dot expressions (`.importBatch.create(...)` and `.importBatchRow.deleteMany(...)`) that TypeScript cannot parse, causing TS1109 errors and failing the BUILD_IMAGE stage at the tsc step.

## Solution

Restored `await prisma.importBatch.create(...)` on line 83 and `await prisma.importBatchRow.deleteMany(...)` on line 107, reinstating valid syntax so the build compiles successfully.

### Changes
- **Modified** `src/services/importService.ts`

## PR #2: Stream XLSX/JSON imports to handle large files without memory exhaustion

**Status:** MERGED into repository  
**Source:** [GitHub PR #2](https://github.com/CayelaemJ/NewChanges/pull/2)

### Recorded problem, implementation and test notes

## Problem
Large file uploads (40MB+) crash the app because the entire file is loaded into memory before processing. XLSX and JSON files accumulate all rows in arrays, exhausting heap space.

## Solution
Refactored the import pipeline to stream validated rows in bounded chunks for all file formats:

### Changes

**importParser.ts**
- Added `parseAndValidateXlsxJsonStreaming()` function that processes XLSX/JSON files similarly to the existing CSV streaming logic
- Parses the file upfront (required by xlsx/json libraries), but validates and emits rows incrementally via callback
- Chunks validated rows and flushes them to `onRows()` callback in bounded batches (2000 rows default) instead of accumulating into one giant array
- Peak memory is now bounded to one chunk size + parsing buffer, regardless of total file size

**importService.ts**
- Updated import statement to include `parseAndValidateXlsxJsonStreaming`
- Modified `uploadAndValidate()` to use streaming validation for both CSV and XLSX/JSON formats
- Removed the old code path that accumulated validated rows into `result.rows` before chunking to database

## Result
- Memory usage is now independent of file size for all formats
- Validation preview (10 rows) is still captured for UI feedback
- Database writes remain chunked, avoiding transaction timeouts on large imports
- All three formats (CSV, XLSX, JSON) now share the same bounded-memory streaming pattern

## Testing
- TypeScript compilation passes with no errors
- Logic is identical to existing CSV streaming implementation
- Ready for integration with expanded Postgres volume

### System impact and change-history relationship

Validation and persistence now process row batches instead of keeping all validated rows in memory. Initial XLSX/JSON parsing may still require a full parsing buffer. The PR does not establish a guaranteed maximum source-file size.

## PR #3: Optimize imports with deferred validation, progress tracking, and early first-row feedback

**Status:** MERGED into repository  
**Source:** [GitHub PR #3](https://github.com/CayelaemJ/NewChanges/pull/3)

### Recorded problem, implementation and test notes

## Problem
Import uploads of 40MB+ files crash due to expensive validation running on every row during streaming (especially duplicate key detection). Users have no visibility into progress and must wait in the dark. Format errors only appear after processing the entire file.

## Solution
Three-part optimization: (1) defer expensive validation to commit time, (2) track progress in real-time, (3) validate first row eagerly for immediate feedback.

### Changes

**prisma/schema.prisma**
- Added `rowsProcessed: Int @default(0)` to `ImportBatch` — tracks rows ingested so far
- Added `firstRowError: String?` to `ImportBatch` — captures format errors on row 1

**src/services/validationStrategies.ts** (new file)
- Split validation logic into two strategies:
  - `validateRecordEarly()`: Coercion, required fields, business rules (runs during streaming)
  - `validateRecordDeferred()`: Duplicate natural key detection (runs at commit time)
- Exports `CellError` interface for type safety

**src/services/importParser.ts**
- Now uses validation strategies instead of inline logic
- `parseAndValidateCsvStreaming()` and `parseAndValidateXlsxJsonStreaming()` skip duplicate checks during streaming
- Added `validateBatchDeferred()` for end-of-import validation
- Kept `validate()` for backward compatibility with syncService.ts (runs full validation for API/SQL imports)

**src/services/importService.ts**
- Updated `uploadAndValidate()` to wrap chunk writer with progress tracking
- `rowsProcessed` is updated to the database after each 2000-row chunk arrives
- Captures `firstRowError` for immediate user feedback
- Imported `validateBatchDeferred` for future commit-time validation

### Performance Impact
- **Speed**: Duplicate detection deferred to commit time = 2-5x faster validation during upload
- **Memory**: Validation runs in bounded chunks only during streaming
- **UX**: Frontend can poll `/api/import/progress/:batchId` every 500ms to show real-time progress bar
- **Safety**: First-row validation catches format errors immediately (within 1-2 seconds of upload start)

### Frontend Integration
Add to your API routes:
```typescript
router.get("/api/import/progress/:batchId", async (req, res) => {
  const batch = await prisma.importBatch.findUnique({
    where: { id: req.params.batchId },
    select: { status: true, rowCount: true, rowsProcessed: true, errorCount: true, firstRowError: true },
  });
  const progress = batch.rowCount > 0 ? Math.round((batch.rowsProcessed / batch.rowCount) * 100) : 0;
  return res.json({ progress, status: batch.status, firstRowError: batch.firstRowError });
});
```

Frontend polls this endpoint every 500ms to update a progress bar. If `firstRowError` is set, show it immediately.

## Testing
- TypeScript compilation passes
- All imports remain functional (validate() backward compatible)
- Ready for large file testing (40MB+ CSV/XLSX/JSON)

### System impact and change-history relationship

Rows processed and first-row error fields support progress feedback; the PR description contains an example endpoint, which must not be interpreted as proof that the example route was installed.

## PR #4: Add files via upload

**Status:** MERGED into repository  
**Source:** [GitHub PR #4](https://github.com/CayelaemJ/NewChanges/pull/4)

### Recorded problem, implementation and test notes

_The PR description is empty. Its title alone is not enough to infer implementation details; use the linked diff for an exact technical audit._

### Evidence limitation

No implementation-level description was provided with this PR. Its exact file changes should be checked in the GitHub Files changed tab before this record is treated as a verified feature specification.

## PR #5: New Patches to fix dashboard

**Status:** MERGED into repository  
**Source:** [GitHub PR #5](https://github.com/CayelaemJ/NewChanges/pull/5)

### Recorded problem, implementation and test notes

Added the new patches so that we can fix slicers on the dashboard as they were giving issues

## PR #6: Add files via upload

**Status:** MERGED into repository  
**Source:** [GitHub PR #6](https://github.com/CayelaemJ/NewChanges/pull/6)

### Recorded problem, implementation and test notes

_The PR description is empty. Its title alone is not enough to infer implementation details; use the linked diff for an exact technical audit._

### Evidence limitation

No implementation-level description was provided with this PR. Its exact file changes should be checked in the GitHub Files changed tab before this record is treated as a verified feature specification.

## PR #7: Add files via upload

**Status:** MERGED into repository  
**Source:** [GitHub PR #7](https://github.com/CayelaemJ/NewChanges/pull/7)

### Recorded problem, implementation and test notes

_The PR description is empty. Its title alone is not enough to infer implementation details; use the linked diff for an exact technical audit._

### Evidence limitation

No implementation-level description was provided with this PR. Its exact file changes should be checked in the GitHub Files changed tab before this record is treated as a verified feature specification.

## PR #8: Merge pull request #7 from CayelaemJ/CayelaemJ-patch-4

**Status:** MERGED into repository  
**Source:** [GitHub PR #8](https://github.com/CayelaemJ/NewChanges/pull/8)

### Recorded problem, implementation and test notes

Add files via upload

## PR #16: Railway Deployment #ee6bf0 fix: type CSV export route params

**Status:** MERGED into repository  
**Source:** [GitHub PR #16](https://github.com/CayelaemJ/NewChanges/pull/16)

### Recorded problem, implementation and test notes

## Problem

The Railpack build failed during 'npm run build' (tsc) with TS18046 on req.params.batchId and TS2339 on e.message in the /api/admin/batches/:batchId/csv route, because the route was declared without a Fastify route generic, leaving req.params typed as unknown and the catch block's error typed as {}.

## Solution

Added the `` generic to the app.get call so req.params.batchId resolves to a string, and typed the catch parameter as `e: any` to match the pattern used elsewhere in the file, resolving both compile errors.

### Changes
- **Modified** `src/server.ts`

### Context
- **Deployment**: [#ee6bf0](https://railway.com/project/5178bc1e-e819-4b3c-b296-47331bc8d58e/environment/07f92af8-ac8b-4e1c-baa5-a865b19c6ab2/deployment/ee6bf073-1a26-4128-aed1-c75996e75fc1)
- **Failed commit**: `5cfa7d9`

## PR #17: Update package.json

**Status:** MERGED into repository  
**Source:** [GitHub PR #17](https://github.com/CayelaemJ/NewChanges/pull/17)

### Recorded problem, implementation and test notes

_The PR description is empty. Its title alone is not enough to infer implementation details; use the linked diff for an exact technical audit._

### Evidence limitation

No implementation-level description was provided with this PR. Its exact file changes should be checked in the GitHub Files changed tab before this record is treated as a verified feature specification.

## PR #18: Update importService.ts

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #18](https://github.com/CayelaemJ/NewChanges/pull/18)

### Recorded problem, implementation and test notes

_The PR description is empty. Its title alone is not enough to infer implementation details; use the linked diff for an exact technical audit._

### Evidence limitation

No implementation-level description was provided with this PR. Its exact file changes should be checked in the GitHub Files changed tab before this record is treated as a verified feature specification.

## PR #19: Update server.ts

**Status:** MERGED into repository  
**Source:** [GitHub PR #19](https://github.com/CayelaemJ/NewChanges/pull/19)

### Recorded problem, implementation and test notes

_The PR description is empty. Its title alone is not enough to infer implementation details; use the linked diff for an exact technical audit._

### Evidence limitation

No implementation-level description was provided with this PR. Its exact file changes should be checked in the GitHub Files changed tab before this record is treated as a verified feature specification.

## PR #20: Fix admin branding & add logo color analysis

**Status:** MERGED into repository  
**Source:** [GitHub PR #20](https://github.com/CayelaemJ/NewChanges/pull/20)

### Recorded problem, implementation and test notes

## Problem

**Issue 1: Admin branding bug**
When admins viewed `/api/auth/me`, the endpoint incorrectly applied partner-specific themes. Admins have no partner assignment and should always see the plain empower-fin default branding (purple), not employer themes.

**Issue 2: Missing color detection**
The admin panel lost the ability to analyze a logo image and auto-extract dominant colors for the theme color fields.

## Solution

### 1. Admin Theme Fix
- Updated `/api/auth/me` endpoint to check `user.role === "ADMIN"` and always return `DEFAULT_THEME`
- Regular users still get their assigned partner theme, or the specific employer's theme when viewing that employer
- Admins now consistently see plain empower-fin branding across all views

### 2. Color Field Renaming & Descriptions
Renamed color fields for clarity with design-accurate naming:
- `primaryColor` → `primaryBrandColor` (10% — signature identity color)
- `accentColor` → `secondaryColor` (30% — supports primary, used for secondary buttons/nav)
- `navyColor` → `dominantBackgroundColor` (60% — canvas: white, off-white, or dark mode)

Updated throughout:
- `partnerService.ts` — all field references
- `admin.html` — color picker labels with role descriptions
- `prisma/schema.prisma` — database schema

### 3. Logo Color Analysis Endpoint
- Added `/api/admin/partners/:id/analyze-logo` POST endpoint
- Accepts image pixel data extracted via browser canvas
- Returns the three dominant brand colors using RGB quantization + HSL scoring:
  - **primaryBrandColor**: highest brand score (vibrant, saturated)
  - **secondaryColor**: complementary supporting color
  - **dominantBackgroundColor**: darkest color (canvas)
- Created `colorAnalysisService.ts` with intelligent color extraction algorithm
- Admin UI now has "📸 Analyze Logo" button that uploads a logo, extracts colors, and auto-populates the three fields

### Changes Made
- `src/server.ts` — fixed `/api/auth/me` logic, added color analysis endpoint import
- `src/services/colorAnalysisService.ts` — new color extraction service
- `src/services/partnerService.ts` — renamed color fields throughout
- `public/admin.html` — updated color picker UI with descriptions, added `analyzeLogoForColors()` function
- `prisma/schema.prisma` — renamed Partner model fields

✅ Build passes (TypeScript compilation successful)

## PR #21: Railway Deployment #28797f fix: preserve Partner color columns

**Status:** MERGED into repository  
**Source:** [GitHub PR #21](https://github.com/CayelaemJ/NewChanges/pull/21)

### Recorded problem, implementation and test notes

## Problem

PRE_DEPLOY_COMMAND (prisma db push) failed because PR #20 renamed Partner.primaryColor/accentColor/navyColor to primaryBrandColor/secondaryColor/dominantBackgroundColor in the Prisma schema without a migration. Since this project has no prisma/migrations directory and relies on db push, Prisma saw the rename as dropping three columns that still held 10 non-null values each, so it refused to proceed without --accept-data-loss.

## Solution

Added @map("primaryColor"), @map("accentColor"), and @map("navyColor") to the renamed fields so Prisma keeps using the existing database column names while the application code continues to use the new field names. This eliminates the schema drift that triggered the data-loss warning, allowing db push to succeed without dropping any existing partner branding data.

### Changes
- **Modified** `prisma/schema.prisma`

### Context
- **Deployment**: [#28797f](https://railway.com/project/5178bc1e-e819-4b3c-b296-47331bc8d58e/environment/07f92af8-ac8b-4e1c-baa5-a865b19c6ab2/deployment/28797f6a-e9cc-4f83-9c43-9120fb912b27)
- **Failed commit**: `56ef6e7`

## PR #22: Fix users logout bug, add logo color detection, improve admin UI

**Status:** MERGED into repository  
**Source:** [GitHub PR #22](https://github.com/CayelaemJ/NewChanges/pull/22)

### Recorded problem, implementation and test notes

## Fixes

### 1. **Users Page Logout Bug** 🔐
Fixed session loss when navigating to Users page. The `/api/users` fetch calls were missing `credentials: "include"` header, preventing session cookies from being sent. Admins are now properly authenticated when accessing the Users management page.

**Change**: Added `credentials: "include"` to all fetch calls to `/api/users` in admin.html.

### 2. **Logo Color Analysis** 🎨
Added the ability for admins to upload a partner logo and automatically extract the three dominant brand colors (primary, accent, navy). Uses intelligent RGB quantization with HSL scoring to identify vibrant, suitable brand colors.

**New Files**:
- `src/services/colorAnalysisService.ts` — Logo color extraction algorithm (RGB quantization + HSL scoring)

**New Endpoint**:
- `POST /api/admin/partners/:id/analyze-logo` — Accepts base64-encoded pixel data from canvas, returns detected colors

**New UI**:
- Added "📸 Detect from logo" button in partner color picker section
- `analyzeLogoForColors()` function handles logo upload → canvas extraction → API call → auto-populate colors

### 3. **Admin UI Improvements** ✨
Refactored the partner editor UI for a cleaner, less clunky appearance:
- **Color picker section**: Now in a subtle purple background box with smaller, tighter inputs and the analyze button
- **Layout**: Improved grid spacing, better visual hierarchy, smaller font sizes for inputs
- **Tagline/Logo row**: Better proportions (2fr/1fr split instead of equal)
- **Overall**: Better spacing, improved accessibility, more modern look

**Changes to admin.html**:
- Replaced clunky `grid-template-columns:repeat(3,1fr) 2fr` layout with dedicated color section
- Added background styling to color picker group
- Improved input styling (smaller padding, better borders)
- Better label hierarchy with `` tags
- Added placeholder text to tagline input for guidance

## Testing
- ✅ TypeScript build passes
- ✅ Session credentials now sent with API calls
- ✅ Color analysis algorithm tested with various logo colors
- ✅ Admin UI renders cleanly with improved spacing

## Context
When no partner branding is assigned, users see the default empower-fin theme (same as admin sees). Partner-specific colors only apply when a partner is assigned to an employer through the admin panel.

## PR #23: Railway Deployment #29f18b fix: map renamed Partner color fields

**Status:** MERGED into repository  
**Source:** [GitHub PR #23](https://github.com/CayelaemJ/NewChanges/pull/23)

### Recorded problem, implementation and test notes

## Problem

Pre-deploy failed because prisma/schema.prisma renamed Partner.primaryColor/accentColor/navyColor to primaryBrandColor/secondaryColor/dominantBackgroundColor without preserving the underlying column names. Prisma db push saw this as dropping three non-null columns, triggering a data-loss warning that the pre-deploy script correctly refuses to apply without --accept-data-loss.

## Solution

Added @map("primaryColor"), @map("accentColor"), and @map("navyColor") to the renamed fields so Prisma recognizes them as the same existing database columns. This eliminates the destructive schema diff while keeping the new field names used in partnerService.js unchanged.

### Changes
- **Modified** `prisma/schema.prisma`

### Context
- **Deployment**: [#29f18b](https://railway.com/project/5178bc1e-e819-4b3c-b296-47331bc8d58e/environment/07f92af8-ac8b-4e1c-baa5-a865b19c6ab2/deployment/29f18bb6-92a1-4126-9ac8-64318f990db3)
- **Failed commit**: `33edd88`

## PR #24: Railway Deployment #dadea9 fix: remove duplicate ok key

**Status:** MERGED into repository  
**Source:** [GitHub PR #24](https://github.com/CayelaemJ/NewChanges/pull/24)

### Recorded problem, implementation and test notes

## Problem

TypeScript build failed with TS2783 in src/services/dailyRefresh.ts because triggerRefreshNow() returned { ok: true, ...result } where result already contains an ok property from both refreshViaDbProcedure() and refreshViaAppPipeline(), causing the explicit ok: true to always be overwritten and fail the strict tsc build.

## Solution

Removed the redundant ok: true literal so the function returns { ...result }, preserving the correct ok value from the underlying result while eliminating the duplicate-key compile error.

### Changes
- **Modified** `src/services/dailyRefresh.ts`

### Context
- **Deployment**: [#dadea9](https://railway.com/project/5178bc1e-e819-4b3c-b296-47331bc8d58e/environment/07f92af8-ac8b-4e1c-baa5-a865b19c6ab2/deployment/dadea904-c39d-4602-ae9b-ba63ea21c82f)
- **Failed commit**: `08fb733`

## PR #25: Fix first sync to load all records without date filtering

**Status:** MERGED into repository  
**Source:** [GitHub PR #25](https://github.com/CayelaemJ/NewChanges/pull/25)

### Recorded problem, implementation and test notes

## Problem

On the first sync of an external MySQL source, `runSync` always computed `requestSince` from `overlapCursor(cursor.lastSourceUpdatedAt)`. Although `lastSourceUpdatedAt` is NULL on first sync (which should yield no filter), the intent to "load everything" wasn't explicit, and any accidental overlap/cursor logic applied at this stage could suppress rows, resulting in 0 records being fetched despite data existing in the source views.

## Solution

Added an explicit `isFirstSync` check (`cursor.lastSourceUpdatedAt === null && cursor.lastSuccessAt === null`) in `runSync()`. When true, `since` is passed as `null` directly to `fetchReport`, bypassing the overlap cursor entirely and logging that a full first load is happening. Subsequent syncs still use `overlapCursor(cursor.lastSourceUpdatedAt)` as before. The existing post-commit logic already sets `lastSourceUpdatedAt` to `throughAt` on success, so future syncs correctly switch to incremental mode.

### Changes
- **Modified** `src/services/syncService.ts`

### System impact and change-history relationship

The distinction between first full extraction and subsequent incremental extraction prevents stale cursors from excluding records during initial onboarding.

## PR #26: Add detailed sync logging to debug zero records issue

**Status:** MERGED into repository  
**Source:** [GitHub PR #26](https://github.com/CayelaemJ/NewChanges/pull/26)

### Recorded problem, implementation and test notes

## Summary

Sync is returning 0 records even though the underlying MySQL views exist and contain data, and the config/connection have been verified. To diagnose without guessing, added timestamped console.log statements throughout src/services/sourceAdapter.ts: the MySQL queryReport and probe functions now log the exact view being queried, the SQL text, bound parameters, and the row/column count returned (or the error if the query fails), and createSqlAdapter's fetchReport now logs the report key, resolved location, row count returned by the executor, and the record count after normalization. This will surface whether the wrong schema/view is being hit, whether the query is malformed, or whether rows are being dropped during normalization.

### Changes
- **Modified** `src/services/sourceAdapter.ts`

## PR #27: Fix: regenerate package-lock.json to match updated dependencies

**Status:** MERGED into repository  
**Source:** [GitHub PR #27](https://github.com/CayelaemJ/NewChanges/pull/27)

### Recorded problem, implementation and test notes

## Problem
The build was failing with an npm ci error because `package-lock.json` was out of sync with `package.json`.

Build logs showed:
- `csv-parse@5.6.0` does not satisfy `csv-parse@7.0.3`
- `node-cron@4.6.0` missing from lock file
- `nodemailer@7.0.13` does not satisfy `nodemailer@9.1.1`

## Solution
Regenerated `package-lock.json` by running `npm install` to resolve the updated dependencies:
- csv-parse bumped to ^7.0.2
- nodemailer bumped to ^9.1.1  
- node-cron newly added at ^4.6.0

The lockfile now correctly reflects all dependency versions and transitive dependencies with proper integrity hashes. The Docker build will now succeed at the `npm ci` step.

## Testing
After merging, redeploy the NewChanges service to confirm the build completes successfully.

## PR #28: Production hardening, governance, mobile cleanup, and score regression gates

**Status:** MERGED into repository  
**Source:** [GitHub PR #28](https://github.com/CayelaemJ/NewChanges/pull/28)

### Recorded problem, implementation and test notes

## Production hardening

This branch addresses the production-readiness audit without deploying directly to Production.

### Security/governance
- Adds CODEOWNERS and Dependabot governance.
- Adds SECURITY.md and explicit production release gates.
- Adds SSRF protections to the configurable external API connector: blocks private/local/link-local/reserved destinations, validates URL structure, supports an explicit SOURCE_API_ALLOWED_HOSTS allowlist, and disables redirects.
- Keeps existing session hashing, CSRF/same-origin checks, security headers, rate limiting, XSS escaping and tenant authorization.

### Code quality / mobile
- Consolidates the dashboard's four incremental UI/responsive CSS layers into one canonical public/dashboard.css and removes the superseded files.
- Keeps the existing responsive behavior while removing the v1/v2 patch stack.

### Scoring
- Adds deterministic regression tests for the 20/30/30/20 scoring weights, unavailable-driver behavior, debt-risk denominator, insurance edge case, and invalid weight rejection.
- Adds npm run test:score and includes it in CI.
- Adds npm run check:all as the single release verification command.

### Not included
- No Production deployment.
- No production secrets changed.
- GitHub branch protection/rulesets still need to be configured at the repository level; the connected GitHub API does not expose the required private-repository ruleset administration permission in this session.

Please run the PR CI suite before merge and keep Production deployment gated on all required checks.

### System impact and change-history relationship

Release governance, SSRF protection, scoring regression tests and canonical CSS consolidation are significant safeguards, but GitHub configuration and actual production rollout require separate evidence.

## PR #29: build(deps): bump actions/checkout from 4 to 7

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #29](https://github.com/CayelaemJ/NewChanges/pull/29)

### Recorded problem, implementation and test notes

Bumps [actions/checkout](https://github.com/actions/checkout) from 4 to 7.

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #30: build(deps): bump actions/setup-node from 4 to 7

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #30](https://github.com/CayelaemJ/NewChanges/pull/30)

### Recorded problem, implementation and test notes

Bumps [actions/setup-node](https://github.com/actions/setup-node) from 4 to 7.

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #31: build(deps): bump prisma from 5.22.0 to 7.10.0

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #31](https://github.com/CayelaemJ/NewChanges/pull/31)

### Recorded problem, implementation and test notes

Bumps [prisma](https://github.com/prisma/prisma-cli/tree/HEAD/packages/prisma) from 5.22.0 to 7.10.0.

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #32: deps: bump mssql and @types/mssql

**Status:** OPEN — not released  
**Source:** [GitHub PR #32](https://github.com/CayelaemJ/NewChanges/pull/32)

### Recorded problem, implementation and test notes

Bumps [mssql](https://github.com/tediousjs/node-mssql) and [@types/mssql](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/mssql). These dependencies needed to be updated together.
Updates `mssql` from 11.0.1 to 12.7.2
Updates `@types/mssql` from 9.1.11 to 12.3.0

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #33: build(deps): bump @prisma/client from 5.22.0 to 7.10.0

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #33](https://github.com/CayelaemJ/NewChanges/pull/33)

### Recorded problem, implementation and test notes

Bumps [@prisma/client](https://github.com/prisma/prisma/tree/HEAD/packages/client) from 5.22.0 to 7.10.0.

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #34: build(deps): bump @types/node from 22.19.19 to 26.6.3

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #34](https://github.com/CayelaemJ/NewChanges/pull/34)

### Recorded problem, implementation and test notes

Bumps [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/node) from 22.19.19 to 26.6.3.

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #35: build(deps): bump mysql2 from 3.24.2 to 3.24.4

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #35](https://github.com/CayelaemJ/NewChanges/pull/35)

### Recorded problem, implementation and test notes

Bumps [mysql2](https://github.com/sidorares/node-mysql2) from 3.24.2 to 3.24.4.

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #36: Enterprise mobile ratings and intelligent brand visuals

**Status:** MERGED into repository  
**Source:** [GitHub PR #36](https://github.com/CayelaemJ/NewChanges/pull/36)

### Recorded problem, implementation and test notes

Fixes the mobile Value Delivered section, makes employee rating stars reflect the actual average (including half-stars), and upgrades the brand engine/chart palette for more representative, perceptually balanced enterprise visualisation. Adds regression coverage for the generated chart palette. No production deployment is performed by this change.

## PR #37: Fix month-to-month financial chart comparisons and axis layout

**Status:** MERGED into repository  
**Source:** [GitHub PR #37](https://github.com/CayelaemJ/NewChanges/pull/37)

### Recorded problem, implementation and test notes

Fixes the remaining financial chart issue after PR #36 was merged. Month selection and latest available period now produce explicit current-month versus previous-month points for Monthly Cash Freed Up and Total Advanced per Month, including zero values. Reworks the line-chart geometry to reserve a dedicated Y-axis gutter and prevent value-label overlap. Chart legends use exact month names. Includes regression coverage for latest/month semantics and direct previous-month calculations.

No Production deployment is performed by this PR.

## PR #38: Make month financial charts always render current vs previous month

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #38](https://github.com/CayelaemJ/NewChanges/pull/38)

### Recorded problem, implementation and test notes

Fixes the remaining month-chart defect. When a month/latest period is active, Monthly Cash Freed Up and Total Advanced per Month now always construct exactly two financial points from the current period and the prior-period totals, even if the richer periodComparison payload is missing. The server exposes previous-period raw totals for the frontend fallback. This prevents the old one-point trend path that produced a Y-axis plus a lone x-axis marker with no visible line.

Checks are green. No Production deployment is performed by this PR.

## PR #39: Fix stale dashboard cache for month financial comparisons

**Status:** MERGED into repository  
**Source:** [GitHub PR #39](https://github.com/CayelaemJ/NewChanges/pull/39)

### Recorded problem, implementation and test notes

The dashboard was still serving old exact-month payloads from the persistent DashboardCohortCache after the month-comparison implementation changed. Those cached payloads lacked periodComparison, causing the frontend to fall back to a one-point trend with a Y-axis and no visible line.

This PR:
- versions the persistent dashboard cache schema so old month payloads cannot be reused;
- keeps a defensive two-point month comparison fallback in the dashboard using current and previous financial totals;
- exposes previous-period raw financial totals for that fallback;
- adds regression coverage for the cache contract and month chart behaviour.

No Production deployment is performed by this PR.

## PR #40: Restore legacy month run-rate chart behaviour

**Status:** MERGED into repository  
**Source:** [GitHub PR #40](https://github.com/CayelaemJ/NewChanges/pull/40)

### Recorded problem, implementation and test notes

The uploaded EFS Optimise version was used as the source of truth for the chart semantics. This PR fixes the dashboard renderer so that:

- Monthly Cash Freed Up remains a cumulative recurring-savings run-rate.
- Total Advanced per Month is a monthly finalised-advance run-rate.
- When Latest available or an explicit month is selected, both charts compare the previous month directly with the selected month as a two-point line.
- Exact month labels and full financial values are shown.
- The old one-point fallback that produced only an axis and x-axis marker is no longer used for month views.
- Regression coverage locks the legacy run-rate semantics and comparison behaviour.

The cache/schema fix from PR #39 is already in main. No direct Production change is made by this PR.

### System impact and change-history relationship

The charts represent recurring savings and finalized EWA advances, not arbitrary raw totals. A direct comparison with the immediately preceding month is the expected output for month filters.

## PR #41: Make financial chart values responsive across desktop tablet and mobile

**Status:** MERGED into repository  
**Source:** [GitHub PR #41](https://github.com/CayelaemJ/NewChanges/pull/41)

### Recorded problem, implementation and test notes

Follow-up to the merged run-rate chart fix. This PR keeps the legacy month-to-month line semantics and moves full financial values out of the SVG plot into responsive value cards above the graph. The chart remains a clean line with a protected Y-axis gutter. Responsive rules cover desktop, tablet, portrait phone, and landscape phone so full values such as R 1 947 000 remain readable without overlapping the axis or being clipped.

No Production deployment is performed by this PR.

## PR #42: Fix 1000x formatting on month financial comparison values

**Status:** MERGED into repository  
**Source:** [GitHub PR #42](https://github.com/CayelaemJ/NewChanges/pull/42)

### Recorded problem, implementation and test notes

The merged month-comparison charts are now using the correct August-to-September run-rate values, but the responsive value cards are still formatting those full-rand values with the thousands multiplier. This makes R 1 999 639 display as R 1 999 639 000.

This PR fixes both month comparison chart cards to use the full-rand formatter and adds a regression assertion so the 1000x presentation bug cannot return.

No Production deployment is performed by this PR.

## PR #43: Add enterprise Security & Identity Center and richer Users admin

**Status:** MERGED into repository  
**Source:** [GitHub PR #43](https://github.com/CayelaemJ/NewChanges/pull/43)

### Recorded problem, implementation and test notes

Adds an enterprise security/identity layer to the Admin and Users experience.

Included:
- session telemetry: last seen, duration, device, browser, operating system, IP and coarse location context when trusted proxy headers provide it;
- login history for successful and failed attempts;
- session history retention and per-session admin revocation;
- revoke-all-sessions for a user;
- Security & Identity Center on Users with live session monitoring, recent sign-ins, alerts, user security drawer, search/filter tools and Security actions;
- Administration security posture summary;
- high-impact admin action risk classification and security alerts for bulk/unusual activity;
- instrumentation of user changes, resets/deletes, imports and section permission changes;
- append-only audit log remains intact;
- 180-day retention for login events and ended sessions;
- Prisma migration and security regression release gate.

Location is intentionally coarse and uses trusted proxy/location headers when available. No precise GPS tracking is introduced.

No Production deployment is performed by this PR.

### System impact and change-history relationship

Session monitoring and revocation provide operational identity visibility; logging and display do not automatically demonstrate security compliance.

## PR #44: feat: strengthen security operations, data governance and audit controls

**Status:** MERGED into repository  
**Source:** [GitHub PR #44](https://github.com/CayelaemJ/NewChanges/pull/44)

### Recorded problem, implementation and test notes

## What this PR changes

### Users and Security UI
- Removes the duplicate Security action appearing beside existing users.
- Separates Device Intelligence and Sensitive Data Access into full-width panels.
- Prevents long routes and locations from colliding with adjacent content.
- Shows the top 20 most recent sensitive-access events.

### Audit and governance
- Adds an admin-only full Security Audit CSV export covering:
  - admin actions
  - sensitive API access
  - successful and failed logins
  - security alerts
- Adds visible Data Governance controls and Cyber Security Operations controls to the Users security centre.
- Keeps audit logging payload-minimal. Request bodies are not captured.

### Regression coverage
- Adds a security governance regression check and wires it into the full check suite.

This PR is intentionally based on `main`. No changes are being committed to `main` directly.

## PR #45: feat: add South Africa privacy, cyber security and data governance controls

**Status:** MERGED into repository  
**Source:** [GitHub PR #45](https://github.com/CayelaemJ/NewChanges/pull/45)

### Recorded problem, implementation and test notes

## South Africa compliance and security controls

This PR adds an operational governance layer for POPIA, PAIA and South African cybersecurity requirements.

### POPIA / data governance
- Processing activity register with:
  - purpose
  - lawful basis
  - responsible-party/operator role
  - data categories
  - PIA status
  - retention
  - cross-border basis
  - automated decision/profiling flags
- Data subject request workflow for access, correction, deletion, objection and consent withdrawal.
- Operator/vendor register with cross-border, agreement and security-review controls.
- Retention policy register with legal-hold support.
- Security incident register with Information Officer and regulator notification tracking.

### Cybersecurity
- Security compromise workflow is separated from ordinary security alerts.
- External IP geolocation is disabled by default.
- External geolocation can only be enabled deliberately after the organisation documents and approves the applicable POPIA cross-border transfer basis and provider controls.

### Privacy notice
- Removes the blanket assumption that Empowerfin is always the responsible party.
- Documents processing roles per activity.
- Adds data-subject request handling.
- Adds security compromise handling.
- Adds operator/service-provider language.
- Adds automated decision/profiling safeguards.
- Adds cross-border transfer controls.

### Admin
- Adds a POPIA & Data Governance section to the Administration console.
- Shows processing activities, cross-border processing, open data-subject requests, incidents and governance gaps.
- Adds detail panels for processing activities, vendors, requests, retention and incidents.

### Testing
- Adds South Africa compliance regression checks.
- Adds those checks to CI.

No changes are committed directly to `main`.

### System impact and change-history relationship

Privacy registers and subject-request workflows are implemented controls, not a certification of POPIA or PAIA compliance.

## PR #46: chore: automate daily dependency upgrades

**Status:** MERGED into repository  
**Source:** [GitHub PR #46](https://github.com/CayelaemJ/NewChanges/pull/46)

### Recorded problem, implementation and test notes

## What this does

- Adds Dependabot coverage for npm packages, Docker base images, and GitHub Actions.
- Checks every day at 00:00 South Africa time using Africa/Johannesburg.
- Groups npm production and development upgrades to keep review manageable.
- Groups GitHub Actions upgrades.
- Keeps security updates grouped separately.
- Raises pull requests instead of changing main directly.

## Safety

Dependency updates will still go through the repository CI checks before they can be merged. Major upgrades such as Prisma major-version changes are therefore surfaced as reviewable PRs rather than silently deployed.

No changes are committed directly to main.

## PR #47: deps: bump the github-actions group across 1 directory with 2 updates

**Status:** OPEN — not released  
**Source:** [GitHub PR #47](https://github.com/CayelaemJ/NewChanges/pull/47)

### Recorded problem, implementation and test notes

Bumps the github-actions group with 2 updates in the / directory: [actions/checkout](https://github.com/actions/checkout) and [actions/setup-node](https://github.com/actions/setup-node).
Updates `actions/checkout` from 4 to 7
Updates `actions/setup-node` from 4 to 6

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #48: deps: bump node from 22-slim to 25-slim

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #48](https://github.com/CayelaemJ/NewChanges/pull/48)

### Recorded problem, implementation and test notes

Bumps node from 22-slim to 25-slim.

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #49: deps: bump tsx from 4.22.4 to 4.23.15 in the npm-development group across 1 directory

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #49](https://github.com/CayelaemJ/NewChanges/pull/49)

### Recorded problem, implementation and test notes

Bumps the npm-development group with 1 update in the / directory: [tsx](https://github.com/privatenumber/tsx).
Updates `tsx` from 4.22.4 to 4.23.15

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #50: deps: bump the npm-production group across 1 directory with 6 updates

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #50](https://github.com/CayelaemJ/NewChanges/pull/50)

### Recorded problem, implementation and test notes

Bumps the npm-production group with 6 updates in the / directory:
| Package | From | To |
| --- | --- | --- |
| [@prisma/client](https://github.com/prisma/prisma/tree/HEAD/packages/client) | `5.22.0` | `7.10.0` |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/node) | `22.19.19` | `26.6.3` |
| [mssql](https://github.com/tediousjs/node-mssql) | `11.0.1` | `12.7.2` |
| [mysql2](https://github.com/sidorares/node-mysql2) | `3.24.2` | `3.24.5` |
| [prisma](https://github.com/prisma/prisma-cli/tree/HEAD/packages/prisma) | `5.22.0` | `7.10.0` |
| [typescript](https://github.com/microsoft/TypeScript) | `5.9.3` | `7.0.2` |
Updates `@prisma/client` from 5.22.0 to 7.10.0
Updates `@types/node` from 22.19.19 to 26.6.3
Updates `mssql` from 11.0.1 to 12.7.2
Updates `mysql2` from 3.24.2 to 3.24.5
Updates `prisma` from 5.22.0 to 7.10.0
Updates `typescript` from 5.9.3 to 7.0.2

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #51: feat: enterprise operations and governed analytics routing

**Status:** MERGED into repository  
**Source:** [GitHub PR #51](https://github.com/CayelaemJ/NewChanges/pull/51)

### Recorded problem, implementation and test notes

## What this adds

- Enterprise Operations & Data Architecture centre in Admin
- Data quality and freshness visibility
- Analytics placement controls: PostgreSQL read model, source aggregates, or hybrid
- Per-feed AnalyticsRoute governance
- Governed source-view overrides for SQL integrations
- Source view identifier validation
- Explicit read-only enforcement for source analytics
- Enterprise operations regression coverage

## Data architecture

The default remains:

Source MySQL/API -> governed sync -> PostgreSQL read model -> dashboards

For approved heavy feeds, the sync can now route to a source-side reporting view. This is deliberately constrained to configured SQL views, not arbitrary SQL from the browser.

We are not removing the PostgreSQL read model yet. It remains useful for dashboard performance, historical snapshots, application-owned audit/compliance data, and tenant-safe serving.

## Safety

- No direct commits to main
- No arbitrary SQL playground
- Source analytics is read-only
- Source routing requires SQL mode
- Existing incremental cursors and validation remain in place
- Existing security/compliance checks remain part of the project CI

### System impact and change-history relationship

Analytics placement is governed rather than uncontrolled querying. Read-model and source-aggregate decisions must preserve data isolation and performance.

## PR #52: feat: enterprise analytics source replica routing

**Status:** MERGED into repository  
**Source:** [GitHub PR #52](https://github.com/CayelaemJ/NewChanges/pull/52)

### Recorded problem, implementation and test notes

## What this adds

- Optional source analytics read-replica configuration
- Separate replica connection for approved source workloads
- MySQL replica health endpoint
- Read-only verification and replication-lag monitoring
- Per-route workload classification
- Per-route replica requirement
- Governed source-view overrides are now actually applied by the SQL executors
- Admin controls for replica host, database, account, SSL and lag threshold
- Enterprise Operations visibility for replica health and workload placement
- Regression coverage for the new architecture

## Data architecture

Default behavior remains PostgreSQL for the application read model.

For approved heavy source analytics:

Source MySQL primary -> MySQL read replica -> governed source reporting view -> dashboard/query workload

The replica is never used for writes. Replica credentials can be supplied through the Railway environment using SOURCE_SQL_REPLICA_PASSWORD.

This PR does not remove existing PostgreSQL data or change production routing by default. Replica usage is opt-in per workload.

## Safety

- No direct commits to main
- No arbitrary SQL from the browser
- Source views remain identifier-validated and explicitly configured
- Replica usage is explicit per route
- Read-only state is checked for MySQL replicas
- Replication lag is checked against an administrator-configured threshold
- Secrets are not returned to the browser
- Existing PostgreSQL read-model behavior remains the default

## Verification

The PR adds a dedicated enterprise analytics phase 2 regression check and includes it in the full check pipeline.

No production deployment is being triggered by this work.

### System impact and change-history relationship

The optional replica is a workload separation mechanism. Replica lag, read-only status and fallback behaviour require live verification.

## PR #53: feat: restore unified data ingestion centre

**Status:** MERGED into repository  
**Source:** [GitHub PR #53](https://github.com/CayelaemJ/NewChanges/pull/53)

### Recorded problem, implementation and test notes

## What this fixes

Restores a clear first-class ingestion experience so NewChanges does not appear to have lost file/API/SQL ingestion.

### Ingestion paths
- CSV uploads
- Excel XLSX/XLS uploads
- JSON uploads
- API integration
- SQL integration for PostgreSQL, SQL Server, MySQL/MariaDB
- Existing governed 10-feed contracts remain intact
- Source/read-replica analytics architecture remains intact

### UI changes
- Adds a Data Centre ingestion selector near the top of Administration
- Makes file ingestion explicit rather than describing it as a fallback
- Keeps API and SQL as equal first-class choices
- Adds direct navigation between the three ingestion paths
- Clarifies that all sources enter the governed validation/import pipeline
- Preserves the existing staging, validation, commit and audit controls

### Verification
Adds a regression check covering the file, API and SQL ingestion paths.

No production deployment or merge performed.

## PR #54: fix: restore admin report selector

**Status:** MERGED into repository  
**Source:** [GitHub PR #54](https://github.com/CayelaemJ/NewChanges/pull/54)

### Recorded problem, implementation and test notes

## Fix

The Reports selector was not actually removed from the backend. The endpoint returns HTTP 200, but the admin page crashed while rendering the response because the `esc()` HTML escaping helper was missing.

That caused the catch block to replace the report list with the misleading:
"Could not reach the API. Start the server and reload."

### Changes
- Restore the `esc()` helper used by the report renderer and other admin panels.
- Validate the reports API response before rendering.
- Keep the report selector visible and clickable independently of optional admin panels.
- Use `Promise.allSettled` for secondary admin panels so a failure elsewhere cannot wipe the report uploader.
- Replace the misleading API error with the actual report-loading error.
- Add a regression check covering the selector, clickable rows, and CSV/XLSX/JSON upload control.

The existing workflow remains:
1. Click a report in load order.
2. See its schema and template buttons.
3. Upload CSV, XLSX/XLS, or JSON.
4. Validate and stage the batch.
5. Commit it through the existing governed workflow.

No production deployment performed by this fix.

## PR #55: feat: harden admin realtime jobs and data loading

**Status:** MERGED into repository  
**Source:** [GitHub PR #55](https://github.com/CayelaemJ/NewChanges/pull/55)

### Recorded problem, implementation and test notes

## What this fixes

### Admin Security Centre and POPIA & Data Governance
The summary loaders were being invoked from `boot()` before the later admin script block had defined them. This race could leave the cards permanently showing `-` and "Loading..." even though the APIs returned HTTP 200.

The fix waits for the page load event before booting the admin application, and makes the security/compliance loaders report actual HTTP errors instead of silently swallowing them.

### Transport audit and implementation
- Keep **Fetch** as the default transport for ordinary JSON/API requests.
- Use **XMLHttpRequest** only for file uploads because browser upload progress is exposed through `xhr.upload` progress events.
- Keep **multipart/form-data** for file uploads.
- Add a real upload progress bar.
- Keep upload, commit and source-sync work in background jobs.
- Add job phase, progress percentage and user-facing status messages.
- Add authenticated **Server-Sent Events (SSE)** for job progress.
- Keep short-interval polling as a fallback when SSE is unavailable.
- Add SSE heartbeats and connection cleanup.
- Do not introduce WebSockets because the current product has no need for bidirectional continuous messaging.
- Do not introduce long polling because SSE provides the needed one-way server-to-browser stream with a polling fallback.

### Live admin state
Security and POPIA summary cards refresh every 30 seconds while the admin page is visible.

### Regression coverage
Adds `check:admin-realtime` and includes it in `check:all`.

No production deployment or merge performed by this change.

## PR #56: fix: keep financial comparison labels inside dashboard cards

**Status:** MERGED into repository  
**Source:** [GitHub PR #56](https://github.com/CayelaemJ/NewChanges/pull/56)

### Recorded problem, implementation and test notes

## What this fixes

The month-to-date financial comparison charts can render the current period label, such as "September 2026 (month to date)", beyond the right edge of the SVG/card.

This change:
- anchors the first period label to the left plot edge
- anchors the current period label to the right plot edge
- keeps long labels inside the chart boundary on desktop, phone, and landscape layouts
- adds a regression check so this does not return

No data or comparison logic is changed.

## PR #57: fix: restore dashboard after PR 56 syntax regression

**Status:** MERGED into repository  
**Source:** [GitHub PR #57](https://github.com/CayelaemJ/NewChanges/pull/57)

### Recorded problem, implementation and test notes

PR #56 introduced the intended chart label fix, but the edit accidentally committed literal "\\n" sequences into the JavaScript source instead of real line breaks. That makes the dashboard script fail to parse, so dashboard content does not load.

This PR restores the exact intended JavaScript block with real line breaks. No chart logic is changed beyond restoring the valid syntax.

## PR #58: fix: restore admin console runtime

**Status:** MERGED into repository  
**Source:** [GitHub PR #58](https://github.com/CayelaemJ/NewChanges/pull/58)

### Recorded problem, implementation and test notes

## Summary
- fix the admin console parse failure caused by a duplicate `const replica` declaration
- remove three stale stylesheet references that return HTML instead of CSS because those superseded files were removed

## Evidence
Browser console reported:
- `Uncaught SyntaxError: Identifier 'replica' has already been declared`
- `loadAdminSecuritySummary is not defined`

The duplicate declaration prevented the later admin script block from parsing, which explains the missing security/compliance functions and boot errors.

The browser also reported a stylesheet MIME error. The referenced `ui-enhance-v1.css`, `ui-enhance-v2.css`, and `responsive-v1.css` files are no longer present in `public/`, so their references were removed from admin.html.

No production deployment or merge was performed.

## PR #59: deps: bump esbuild from 0.28.0 to 0.28.2 in the npm-security group across 1 directory

**Status:** OPEN — not released  
**Source:** [GitHub PR #59](https://github.com/CayelaemJ/NewChanges/pull/59)

### Recorded problem, implementation and test notes

Bumps the npm-security group with 1 update in the / directory: [esbuild](https://github.com/evanw/esbuild).
Updates `esbuild` from 0.28.0 to 0.28.2

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #60: Add admin toggle for synthetic test data disclaimer

**Status:** MERGED into repository  
**Source:** [GitHub PR #60](https://github.com/CayelaemJ/NewChanges/pull/60)

### Recorded problem, implementation and test notes

## What this adds

- Adds a persisted **Synthetic test data mode** toggle to Administration.
- Admins can enable/disable it without changing Railway variables.
- Exposes the setting through the authenticated `/api/me` response.
- When enabled, the dashboard shows a persistent warning:
  - all figures/information are synthetic test data
  - they must not be treated as factual, financial, operational, customer, or other real-world information
- Uses the existing PostgreSQL/Prisma configuration infrastructure.
- Default remains **off**.

## Database

Adds `SystemEmailConfig.syntheticDataMode` with a default of `false`. The existing deployment process uses non-destructive `prisma db push`, so no new Railway database/resource is required.

## Scope

This is intentionally a small, isolated change and does not alter the underlying analytics calculations or source data.

## PR #61: Upgrade brand colour recognition with ML Ops telemetry

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #61](https://github.com/CayelaemJ/NewChanges/pull/61)

### Recorded problem, implementation and test notes

## Brand colour recognition / ML Ops upgrade

This upgrades the existing OKLab/OKLCH BrandEngine without replacing the current visual pipeline.

### Added
- Versioned BrandEngine (1.1.0).
- Persisted detection confidence, warnings, diagnostics, detected palette and timestamp.
- Detection status: AUTO_ACCEPTED, NEEDS_REVIEW, MANUAL or UNREVIEWED.
- Admin-only brand-recognition health endpoint with totals, review counts, average confidence, low-confidence count and engine version.
- Existing brand-engine tests now assert the engine exposes a version.

### Behaviour
- Confidence at or above 70% is marked AUTO_ACCEPTED.
- Lower-confidence detections are marked NEEDS_REVIEW.
- Existing colour extraction, contrast enforcement, chart palette generation and dark-mode behaviour remain intact.

### Architecture
No external ML service, model hosting, bucket, vector database or new Railway service is required. The current recognizer is a deterministic local vision and colour-analysis engine, not a trained neural model. These MLOps additions provide operational controls to measure and improve it safely over time.

### Database
Uses the existing PostgreSQL/Prisma database. The normal non-destructive deployment process can apply the schema changes.

## PR #62: Complete brand learning and add governed MLOps platform

**Status:** MERGED into repository  
**Source:** [GitHub PR #62](https://github.com/CayelaemJ/NewChanges/pull/62)

### Recorded problem, implementation and test notes

Completes the brand colour learning system and adds the eight requested MLOps capabilities: data quality, drift, KPI anomaly detection, forecasting, telemetry, human feedback, model promotion/rollback, plus governed continuous brand learning. Admin-only APIs, append-only telemetry, versioning, regression coverage, and sync-triggered assessments are included. No new Railway ML service is required.

### System impact and change-history relationship

Data quality, drift, KPI anomalies, forecasting, human feedback and model lifecycle were joined into governed MLOps capabilities. The separate PR #63 incoming-quarantine proposal was not merged.

## PR #63: Harden MLOps with incoming data anomaly guardrails

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #63](https://github.com/CayelaemJ/NewChanges/pull/63)

### Recorded problem, implementation and test notes

Adds a fail-safe incoming data quality gate before live import commits. Detects non-finite values, suspicious negative financial/count values, robust outliers, missingness spikes, and extreme distribution shifts against the latest committed batch. Suspicious data is quarantined, staged rows are removed, and the decision is recorded in MLOps telemetry. Includes a regression check. This branch is based on PR #62's MLOps platform.

### System impact and change-history relationship

Closed without merging: this specific proposed quality gate must not be claimed as released from PR #63.

## PR #64: deps: bump the npm-development group across 1 directory with 2 updates

**Status:** OPEN — not released  
**Source:** [GitHub PR #64](https://github.com/CayelaemJ/NewChanges/pull/64)

### Recorded problem, implementation and test notes

Bumps the npm-development group with 2 updates in the / directory: [@types/luxon](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/luxon) and [tsx](https://github.com/privatenumber/tsx).
Updates `@types/luxon` from 3.7.5 to 3.7.6
Updates `tsx` from 4.22.4 to 4.23.15

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #65: Fix canonical dashboard route to use React frontend

**Status:** MERGED into repository  
**Source:** [GitHub PR #65](https://github.com/CayelaemJ/NewChanges/pull/65)

### Recorded problem, implementation and test notes

The authenticated /dashboard route was still serving the legacy public/dashboard.html, so the React frontend changes were invisible during normal production testing. This routes /dashboard to the built React frontend while preserving authentication and the existing /react/* routes.

### System impact and change-history relationship

Briefly switched the canonical route to React, later superseded by the rollback in PR #68.

## PR #66: deps: bump the npm-production group across 1 directory with 7 updates

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #66](https://github.com/CayelaemJ/NewChanges/pull/66)

### Recorded problem, implementation and test notes

Bumps the npm-production group with 7 updates in the / directory:
| Package | From | To |
| --- | --- | --- |
| [@prisma/client](https://github.com/prisma/prisma/tree/HEAD/packages/client) | `5.22.0` | `7.10.0` |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/node) | `22.19.19` | `26.6.3` |
| [mssql](https://github.com/tediousjs/node-mssql) | `11.0.1` | `12.7.2` |
| [mysql2](https://github.com/sidorares/node-mysql2) | `3.24.2` | `3.24.5` |
| [nodemailer](https://github.com/nodemailer/nodemailer) | `10.0.12` | `10.0.13` |
| [prisma](https://github.com/prisma/prisma-cli/tree/HEAD/packages/prisma) | `5.22.0` | `7.10.0` |
| [typescript](https://github.com/microsoft/TypeScript) | `5.9.3` | `7.0.2` |
Updates `@prisma/client` from 5.22.0 to 7.10.0
Updates `@types/node` from 22.19.19 to 26.6.3
Updates `mssql` from 11.0.1 to 12.7.2
Updates `mysql2` from 3.24.2 to 3.24.5
Updates `nodemailer` from 10.0.12 to 10.0.13

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #67: Fix React dashboard white screen

**Status:** MERGED into repository  
**Source:** [GitHub PR #67](https://github.com/CayelaemJ/NewChanges/pull/67)

### Recorded problem, implementation and test notes

The production /dashboard route now correctly serves the React app, but the React UI renders blank after PR 65. Production HTTP logs show /api/auth/me succeeds and the React JS/CSS assets load, while no dashboard API request follows. This patch removes the MUI ThemeProvider from the React bootstrap, which is not required for the existing dashboard UI and can fail before App renders. The rest of the MUI Tooltip integration remains available. Please test /dashboard on Production before merging.

## PR #68: Restore original dashboard visual as canonical /dashboard

**Status:** MERGED into repository  
**Source:** [GitHub PR #68](https://github.com/CayelaemJ/NewChanges/pull/68)

### Recorded problem, implementation and test notes

Restores the original production dashboard as the canonical authenticated /dashboard route.

Why:
- The current React dashboard does not visually match the original dashboard.
- public/dashboard.html remains the original visual source of truth.
- /react/dashboard remains available separately for continued React work.

This PR intentionally does not alter the original dashboard markup/styles. It only changes the protected /dashboard route back to dashboard.html.

DO NOT merge until manual desktop, mobile, and mobile-landscape testing is complete.

### System impact and change-history relationship

Restored the original dashboard to the canonical live route to protect visual parity. The separate React migration did not thereby become complete.

## PR #69: deps: bump the npm-production group across 1 directory with 8 updates

**Status:** CLOSED WITHOUT MERGE  
**Source:** [GitHub PR #69](https://github.com/CayelaemJ/NewChanges/pull/69)

### Recorded problem, implementation and test notes

Bumps the npm-production group with 8 updates in the / directory:
| Package | From | To |
| --- | --- | --- |
| [@prisma/client](https://github.com/prisma/prisma/tree/HEAD/packages/client) | `5.22.0` | `7.10.0` |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/node) | `22.19.19` | `26.6.4` |
| [mssql](https://github.com/tediousjs/node-mssql) | `11.0.1` | `12.7.4` |
| [mysql2](https://github.com/sidorares/node-mysql2) | `3.24.2` | `3.24.5` |
| [nodemailer](https://github.com/nodemailer/nodemailer) | `10.0.12` | `10.0.15` |
| [pg](https://github.com/brianc/node-postgres/tree/HEAD/packages/pg) | `8.23.0` | `8.23.1` |
| [prisma](https://github.com/prisma/prisma-cli/tree/HEAD/packages/prisma) | `5.22.0` | `7.10.0` |
| [typescript](https://github.com/microsoft/TypeScript) | `5.9.3` | `7.0.2` |
Updates `@prisma/client` from 5.22.0 to 7.10.0
Updates `@types/node` from 22.19.19 to 26.6.4
Updates `mssql` from 11.0.1 to 12.7.4
Updates `mysql2` from 3.24.2 to 3.24.5

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #70: fix: restore wellness gauge rendering

**Status:** MERGED into repository  
**Source:** [GitHub PR #70](https://github.com/CayelaemJ/NewChanges/pull/70)

### Recorded problem, implementation and test notes

## What changed
- Fix the workforce financial wellness gauge progress rendering in `frontend/src/App.tsx`.
- Use SVG `pathLength="100"` so the score maps directly to the gauge arc regardless of the arc's absolute length.
- Keep the existing branding, score clamping, labels, and gauge geometry unchanged.

## Scope
- Gauge fix only.
- No Railway production configuration changes.
- No database sync changes.
- This PR is intentionally not merged.

## PR #71: fix: restore default dashboard colours for Admin and Super Admin

**Status:** MERGED into repository  
**Source:** [GitHub PR #71](https://github.com/CayelaemJ/NewChanges/pull/71)

### Recorded problem, implementation and test notes

Restore the standard empower-fin dashboard colour palette on the Administration Console.

- Removes the green/grey admin-specific base palette.
- Uses the same default purple/navy brand palette as the dashboard.
- Keeps semantic green/amber/red colours for status states and charts.
- No changes to the main dashboard.
- No Railway changes.

This is intentionally separate from PR #70, which has already been committed.

## PR #72: fix: restore live dashboard wellness gauge

**Status:** MERGED into repository  
**Source:** [GitHub PR #72](https://github.com/CayelaemJ/NewChanges/pull/72)

### Recorded problem, implementation and test notes

Fix the gauge on the actual `/dashboard` production route.

Root cause: `public/dashboard.html` referenced `url(#wg)` but did not define that SVG gradient. PR #70 modified the separate React dashboard component, which is not the production `/dashboard` route.

This PR:
- Defines the missing gauge gradient.
- Uses the existing default dashboard brand colours.
- Uses SVG `pathLength="100"` for reliable 0–100 score rendering.
- Keeps the existing gauge geometry and score display.
- Does not modify Admin/Super Admin colours or database sync.
- Is separate from PR #70 and PR #71.

## PR #73: fix: restore default dashboard theme for admins

**Status:** MERGED into repository  
**Source:** [GitHub PR #73](https://github.com/CayelaemJ/NewChanges/pull/73)

### Recorded problem, implementation and test notes

## Fix
- Keep Admin and Super Admin on the standard blue/navy dashboard palette.
- Prevent the purple portal palette from being applied to the main Dashboard for privileged users.
- Leave Users and Admin pages unchanged.
- PR only, no production changes.

## PR #74: feat: show admin role indicator on dashboard

**Status:** MERGED into repository  
**Source:** [GitHub PR #74](https://github.com/CayelaemJ/NewChanges/pull/74)

### Recorded problem, implementation and test notes

## Changes
- Show `ADMIN` or `★ SUPER ADMIN` in the Dashboard top bar based on the authenticated role.
- Keep the indicator hidden for ordinary users.
- Preserve the default blue/navy Admin Dashboard theme from the existing PR branch.
- No Admin or Users page changes.
- PR only, no production changes.

## PR #75: docs: establish current repository documentation

**Status:** MERGED into repository  
**Source:** [GitHub PR #75](https://github.com/CayelaemJ/NewChanges/pull/75)

### Recorded problem, implementation and test notes

## Summary
- Rebuild the repository README as the current GitHub landing page.
- Document the canonical production dashboard vs the React migration route.
- Add a documentation index and current architecture guide.
- Add deployment, testing/release-gate and scheduled-report documentation.
- Add a current-status document and repository changelog.
- Correct stale README information, including the application version reference and scheduled-report documentation link.

## Scope
Documentation only. No application source, database schema, deployment configuration or production route changes.

## Safety
- Branch: `docs/repository-documentation`
- Base: `main`
- No merge performed.

## PR #76: fix: improve dashboard executive insight contrast

**Status:** MERGED into repository  
**Source:** [GitHub PR #76](https://github.com/CayelaemJ/NewChanges/pull/76)

### Recorded problem, implementation and test notes

## Changes
- Give the Dashboard Executive Insight card a white background.
- Use dark text for the eyebrow and insight copy so the content remains readable.
- Keep the change scoped to `public/dashboard.html`.
- Based directly on current `main`.
- PR only, no production deployment or merge.

## PR #77: hotfix: restore dashboard rendering after executive insight fix

**Status:** MERGED into repository  
**Source:** [GitHub PR #77](https://github.com/CayelaemJ/NewChanges/pull/77)

### Recorded problem, implementation and test notes

## Hotfix
PR #76 placed the Executive Insight CSS inside the JavaScript block in `public/dashboard.html`, causing a JavaScript syntax error and preventing the dashboard from rendering.

This PR:
- Moves the Executive Insight CSS into the document's existing `` block.
- Removes the invalid CSS from the JavaScript section.
- Makes no other functional changes.
- Targets current `main`.

## Incident
The dashboard rendering regression was caused by PR #76. This hotfix is intended to restore normal dashboard rendering immediately.

## PR #78: feat: improve dashboard freshness and mobile responsiveness

**Status:** MERGED into repository  
**Source:** [GitHub PR #78](https://github.com/CayelaemJ/NewChanges/pull/78)

### Recorded problem, implementation and test notes

## Changes

### Dashboard freshness and responsive UI
- Show the dashboard's last successful sync date as **Last synced** instead of presenting the latest source-record timestamp as the sync date.
- Keep the underlying source-data timestamp available as a tooltip so source freshness and portal sync freshness remain distinct.
- Add explicit responsive layouts for tablet, phone, landscape phone and very narrow screens.
- Improve mobile navigation, filters, cards, KPI grids, wellness rows, drawers, comparison cards, tables and chart containers.
- Prevent horizontal viewport overflow and preserve readable financial values.
- Keep the established vanilla dashboard visual language and Brand Engine behavior.

### Authoritative midnight data refresh
- Run the full refresh at **00:00 Africa/Johannesburg** every day, independent of Railway/server timezone.
- Preflight the configured source before any destructive work. A failed preflight leaves the last published dashboard intact.
- Elect one refresh leader across Railway replicas with a PostgreSQL advisory lock.
- Coordinate ordinary manual/scheduled syncs with a shared database lease so they cannot overlap the purge/reload window.
- Purge source-derived dashboard facts, caches, source batches and source cursors, then reload every canonical source report from the beginning through the existing validation/MLOps path.
- Preserve employer and employee identity anchors so user access, partner branding, score configuration, report schedules and separately sourced chat history are not cascade-deleted.
- Accept a legitimately empty canonical feed during an authoritative full refresh.
- Rebuild dashboard snapshots before the refresh can be marked successful.
- Withhold dashboard/portfolio/period data while the authoritative dataset is rebuilding, and continue withholding partial rebuilt data if a post-purge refresh fails.
- Defer scheduled reports while the dashboard dataset is unpublished.
- Show **Purging & rebuilding** during the refresh and **Purged & overwritten** after a successful completed refresh, with the detailed purge/overwrite result retained in sync status.

### Regression coverage
- Add a dedicated `check:daily-refresh` regression gate to CI covering scheduling, preflight ordering, data-preservation rules, Railway locking, full reload behavior, publish gating and visible refresh status.
- Remove an obsolete comparison bar-chart CSS rule detected by the existing UI regression suite.

## Scope
- `public/dashboard.html`
- `src/server.ts`
- `src/services/dailyRefresh.ts`
- `src/services/importService.ts`
- `src/services/reportScheduler.ts`
- `src/services/syncService.ts`
- `scripts/daily-refresh-regression-check.mjs`
- `package.json`
- `.github/workflows/ci.yml`

## Release rule
**PR only. Do not merge to `main` and do not deploy to production until all CI checks pass and the PR is reviewed.**

### Last-successful dashboard publishing
- Treat the dashboard like a published BI model: the last successful dashboard remains visible while an authoritative refresh is rebuilding.
- Capture the current published dashboard before destructive source work; abort before purge if that safety copy cannot be created.
- Do not let the lower-level full sync publish its raw rebuild state. Publication happens only after all source feeds, snapshots and a new published dashboard capture succeed.
- If a post-purge refresh fails, continue serving the last successful published dashboard instead of replacing charts

_The PR contains further details; follow the source link for the full description._

### System impact and change-history relationship

This feature PR later required PR #79 because privileged sessions could inherit a selected employer's branding.

## PR #79: hotfix: keep Admin and Superadmin on empower-fin branding

**Status:** MERGED into repository  
**Source:** [GitHub PR #79](https://github.com/CayelaemJ/NewChanges/pull/79)

### Recorded problem, implementation and test notes

## Problem
After PR78 merged, Admin/Superadmin dashboard sessions could be re-skinned with the selected/first employer's brand (currently ABSA).

## Root cause
- Dashboard loaded the privileged user's default theme correctly, then overwrote it with `applyTheme(live.theme, null)`.
- The chart recolouring guard protected ADMIN but not SUPERADMIN.
- `themeForUser` could still return a partner brand for privileged users.

## Fix
- Preserve the current user context when applying dashboard payload themes.
- Force Admin/Superadmin user-theme resolution to the default empower-fin theme.
- Protect both ADMIN and SUPERADMIN from employer chart recolouring.
- Add UI regression assertions for all three protections.

## Expected behavior
Admin and Superadmin always see the normal empower-fin control-plane UI. Employer/channel-partner branding continues to apply to normal branded users.

### System impact and change-history relationship

Prevents admin and superadmin views inheriting the employer brand when the dashboard payload arrives.

## PR #80: fix: make reset rebuild from the full connected source

**Status:** MERGED into repository  
**Source:** [GitHub PR #80](https://github.com/CayelaemJ/NewChanges/pull/80)

### Recorded problem, implementation and test notes

## Problem

After Reset & Rebuild, the portal could purge the existing source-derived model and then report:

> Cleared 14,640 source-derived rows and accepted 0 rows from the connected source.

That is not valid Power BI-style rebuild behaviour when the connected source still contains data.

## Root cause

The authoritative full-refresh path correctly removed the old cursor (`since = null`) but still applied `through = now` to every source read. Rows outside that timestamp window could therefore be excluded during a reset, while the authoritative zero-row branch still treated the result as a successful empty feed.

## Fix

- Authoritative Reset/Refresh now removes **both** sides of the incremental time window.
  - no `since`
  - no `through`
- The same connected SQL database is reread from scratch on every reset.
- Authoritative SQL rebuilds always inspect the real source-view row count, even without a live progress subscriber.
- If the source view contains rows but extraction returns 0, the rebuild now fails loudly and keeps the last successful published dashboard rather than accepting/publishing an empty rebuild.
- Legitimately empty source views remain supported.
- Added regression guards so this behaviour cannot silently revert.

## Expected behaviour

Reset & Rebuild now behaves like a true source-of-truth reload:

1. preflight source
2. preserve last successful published dashboard
3. purge source-derived target rows
4. reread the **entire connected source**
5. validate and rewrite all structurally valid rows
6. rebuild snapshots
7. publish only after successful completion

## Scope

- `src/services/syncService.ts`
- `scripts/daily-refresh-regression-check.mjs`

Do not merge until CI passes.

### System impact and change-history relationship

Full rebuild must ignore incremental time bounds when extracting the full connected source; an emptied read model should not falsely be treated as an empty source.

## PR #81: Fix MLOps false positives for bounded rating fields

**Status:** MERGED into repository  
**Source:** [GitHub PR #81](https://github.com/CayelaemJ/NewChanges/pull/81)

### Recorded problem, implementation and test notes

Fixes the MLOps data-quality detector so bounded ordinal numeric fields such as 1–5 star ratings are validated by their contractual range but are excluded from distribution-based ROBUST_OUTLIERS and DISTRIBUTION_SHIFT checks.

Changes:
- bump data-quality detector to v2.2.0
- make statistical anomaly detection contract-aware
- run robust outlier/drift checks only on int/decimal contract fields
- add `statisticalProfile` metadata to numeric fields
- mark ratings.stars as `bounded`
- extend the MLOps regression check to prevent this false-positive regression

This preserves hard validation (`stars` must remain 1..5) while preventing the valid 2/3/5-star population from being quarantined simply because 4-star ratings dominate the distribution.

### System impact and change-history relationship

Contract-bounded star ratings are validated against permitted ranges rather than inappropriate outlier/distribution tests.

## PR #82: Fix Early Wage Access duplicate advanceRef upserts

**Status:** MERGED into repository  
**Source:** [GitHub PR #82](https://github.com/CayelaemJ/NewChanges/pull/82)

### Recorded problem, implementation and test notes

PR #81 was already merged before the Early Wage Access fix was added to its old branch. This PR contains only the Step 10 fix.

- bulk salary-advance sync now upserts on the unique business key `advanceRef`
- stops duplicate-key failures such as `Key ("advanceRef")=(302015) already exists`
- preserves PostgreSQL's internal `id` instead of forcing the source advance ID into it
- adds a regression guard so the bulk procedure cannot silently revert to `ON CONFLICT ("id")`

No MySQL source data is changed.

### System impact and change-history relationship

Corrects the EWA business key used for SQL conflict resolution; PR #83 subsequently corrected the internal ID requirement for new inserts.

## PR #83: Fix EWA predeploy SalaryAdvance id generation

**Status:** MERGED into repository  
**Source:** [GitHub PR #83](https://github.com/CayelaemJ/NewChanges/pull/83)

### Recorded problem, implementation and test notes

Fixes the Railway predeploy failure introduced by PR #82.

Root cause: the bulk SQL switched salary advances to upsert on `advanceRef`, but new rows no longer supplied the required PostgreSQL `SalaryAdvance.id`. Prisma's `@default(cuid())` is application-side here, so raw SQL inserts receive no database default and fail with SQLSTATE 23502.

Fix:
- keep `ON CONFLICT ("advanceRef")` so existing advances update correctly
- provide a deterministic internal `id` for new bulk-inserted rows using `md5('salary-advance|' || salary_advance_id)`
- add regression coverage for the required internal id

No MySQL source data is changed.

### System impact and change-history relationship

Restores insertion of required internal IDs while retaining idempotent upserts on the source's advance reference.

## PR #84: Fix viewer channel partner branding in employer dashboard

**Status:** MERGED into repository  
**Source:** [GitHub PR #84](https://github.com/CayelaemJ/NewChanges/pull/84)

### Recorded problem, implementation and test notes

Fixes the React employer dashboard so Viewer users assigned to a channel partner actually see that partner's branding.

Root cause: `/api/auth/me` already returns the correct partner theme for non-admin users, including VIEWER, and the React dashboard already applied the partner colours through Brand Engine — but the topbar logo was still hardcoded to `/static/logo.png`.

Changes:
- use `me.theme.logoDataUrl` when available
- keep empower-fin logo as fallback only when no partner logo exists
- use the partner display name for image alt text
- add regression coverage so the React dashboard cannot silently revert to the hardcoded logo

This does not change Admin/Superadmin branding isolation.

### System impact and change-history relationship

React topbar branding and canonical dashboard payload behaviour are distinct; PR #85 followed to fix the server-side precedence on the actual dashboard.

## PR #85: Fix Viewer channel-partner theme being overwritten on dashboard

**Status:** MERGED into repository  
**Source:** [GitHub PR #85](https://github.com/CayelaemJ/NewChanges/pull/85)

### Recorded problem, implementation and test notes

The previous logo fix did not change the live `/dashboard` because the real issue was server-side theme precedence.

`/api/auth/me` correctly returned the Viewer's assigned channel-partner theme, but `/api/employers/:employerId/dashboard` then replaced `payload.theme` with the employer theme every time. `public/dashboard.html` applies that live payload theme after initial load, so the Viewer partner UI was immediately overwritten.

Fix:
- for non-admin users, preserve the assigned user/channel-partner theme when it is branded
- fall back to employer branding only when the user has no assigned partner theme
- Admin/Superadmin control-plane behavior remains unchanged
- add regression coverage for this precedence rule

### System impact and change-history relationship

The assigned channel-partner theme is preserved through both session identity and employer dashboard data loading.

## PR #86: deps: bump node from 22-slim to 25-slim

**Status:** OPEN — not released  
**Source:** [GitHub PR #86](https://github.com/CayelaemJ/NewChanges/pull/86)

### Recorded problem, implementation and test notes

Bumps node from 22-slim to 25-slim.

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

## PR #87: Align default NewChanges UI with The Fixer brand

**Status:** MERGED into repository  
**Source:** [GitHub PR #87](https://github.com/CayelaemJ/NewChanges/pull/87)

### Recorded problem, implementation and test notes

## Summary
- adds the supplied The Fixer SVG as the default EFS portal logo
- applies the logo across Dashboard, Administration, Users, Login and public/default pages
- adds a shared The Fixer default-brand CSS layer using #2B1D73 and #0FC79B
- updates Brand Engine default fallbacks while preserving runtime partner-brand overrides
- aligns the React frontend copy and MUI/theme defaults
- updates UI/React regression checks for the new default identity

## Guardrail
Partner-specific logo and colour overrides remain untouched and still take precedence over the default EFS theme.

Do not merge until CI and role/partner branding checks pass.

### System impact and change-history relationship

The Fixer default brand does not replace tenant-specific themes.

## PR #88: Remove The Fixer attribution from custom partner UI

**Status:** MERGED into repository  
**Source:** [GitHub PR #88](https://github.com/CayelaemJ/NewChanges/pull/88)

### Recorded problem, implementation and test notes

Final partner-branding cleanup after PR #87.

- Custom partner UI is partner-only: no visible “Powered by The Fixer” text or secondary Fixer logo.
- Removes The Fixer attribution from the Admin client dashboard preview.
- Keeps The Fixer as the default Admin/Super Admin/non-partner brand.
- Retains the smarter brand engine underneath for consistent product UI behaviour.
- Updates regression checks and the brand release checklist to reflect this explicit product decision.

### System impact and change-history relationship

Partner UI is solely partner branded; no default-brand attribution is inserted in custom-branded dashboards.

## PR #89: deps: bump the npm-production group across 1 directory with 10 updates

**Status:** OPEN — not released  
**Source:** [GitHub PR #89](https://github.com/CayelaemJ/NewChanges/pull/89)

### Recorded problem, implementation and test notes

Bumps the npm-production group with 10 updates in the / directory:
| Package | From | To |
| --- | --- | --- |
| [@fastify/cookie](https://github.com/fastify/fastify-cookie) | `11.1.2` | `11.1.3` |
| [@fastify/multipart](https://github.com/fastify/fastify-multipart) | `10.1.2` | `10.1.3` |
| [@prisma/client](https://github.com/prisma/prisma/tree/HEAD/packages/client) | `5.22.0` | `7.10.0` |
| [@types/node](https://github.com/DefinitelyTyped/DefinitelyTyped/tree/HEAD/types/node) | `22.19.19` | `26.6.4` |
| [mssql](https://github.com/tediousjs/node-mssql) | `11.0.1` | `12.7.4` |
| [mysql2](https://github.com/sidorares/node-mysql2) | `3.24.2` | `3.24.5` |
| [nodemailer](https://github.com/nodemailer/nodemailer) | `10.0.12` | `10.0.16` |
| [pg](https://github.com/brianc/node-postgres/tree/HEAD/packages/pg) | `8.23.0` | `8.23.1` |
| [prisma](https://github.com/prisma/prisma-cli/tree/HEAD/packages/prisma) | `5.22.0` | `7.10.0` |
| [typescript](https://github.com/microsoft/TypeScript) | `5.9.3` | `7.0.2` |
Updates `@fastify/cookie` from 11.1.2 to 11.1.3
Updates `@fastify/multipart` from 10.1.2 to 10.1.3

_Dependency PR: version changes remain proposals unless merged; no implied runtime deployment._

---

# Operational incident cross-reference

| Incident or failure mode | Relevant PRs | Engineering interpretation |
| --- | --- | --- |
| File uploads exhausted memory or were slow | #1–#3 | Streaming and progress instrumentation separated parsing, validation and writes. |
| Source appeared empty on first load | #25–#26 | Full-initial-load cursor rules and detailed source query telemetry were added. |
| Partner schema rename threatened existing values | #20–#23 | Prisma field names had to be mapped to existing database columns. |
| Month chart looked blank or had incorrect run-rates | #37–#42 | Chart payload, cache, business meaning, layout and currency formatting all required fixes. |
| Admin security and compliance panels failed to load | #54–#58 | Runtime exceptions and initialization sequencing were corrected. |
| React dashboard rendered blank or diverged from canonical visual | #65–#68 | Canonical route reverted to legacy pending satisfactory React parity. |
| Wellness gauge missing on canonical page | #70 and #72 | React-only repair differed from the active dashboard-route fix. |
| Executive Insight fix broke dashboard JavaScript | #76–#77 | Stylesheet code placement generated a syntax error; hotfix restored parsing. |
| Admin/Super Admin acquired employer branding | #78–#79 | Privileged-user theme context was preserved during payload theme updates. |
| Reset cleared records but rebuilt zero rows | #80 | Unwanted full-refresh upper timestamp constraints were removed. |
| Data quality checks incorrectly blocked 1–5 ratings | #81 | Contract-aware statistical profiling excluded ordinal ratings from unsuitable drift tests. |
| EWA upserts failed on business key and internal IDs | #82–#83 | Natural-key conflict handling and required SQL-generated IDs were separately addressed. |
| Partner Viewer brand was overwritten | #84–#85 | Client logo selection and server-side theme precedence were corrected independently. |
| Default branding contaminated partner dashboards | #87–#88 | Partner white-label surfaces were kept free of The Fixer attribution. |

# Verification model and future changelog entries

For all future changes, record separately: **planned behaviour**, **implementation in code**, **merge status**, **CI proof**, **deployment environment/identifier**, **verified functional result**, **rollback path**, and **known limitations**. Avoid marking a capability as production ready solely because it appears in a merged PR or passes a unit test.
