# NewChanges CircleCI to Docker migration — outstanding coverage

This is an implementation gap register, **not** a passing test report.

## Core jobs from .circleci/config.yml
- verify — PARTIAL: shared suite does not yet run every individual check / TS fixture test in CircleCI.
- admin_browser_smoke — PARTIAL: browser check exists; artifacts not parity-verified.
- source_quality — PARTIAL: lint, types, unit included; same versions/results not yet established.
- browser_smoke — PARTIAL: E2E, console UX, responsive included; reporting incomplete.
- semgrep_security — PARTIAL: local container added; p/javascript, p/typescript, p/security-audit parity and rule acquisition not verified.
- credential_exposure_scan — PARTIAL: scanner tests/scripts available; run outside Git-excluded test image.
- dependency_advisory_audit — PARTIAL: root audit helper exists, frontend audit not established; requires controlled advisory access.
- gitleaks_history_scan — PARTIAL: container script added; ensure full history and secure/redacted reports.
- trivy_vulnerability_scan — PARTIAL: image pinned, but vulnerability DB population/cache, JSON artifacts, scanning parity, and non-root test-image rescan not proven.

## Additional scripts in CircleCI verify not guaranteed in Docker CI
Review and restore existing npm scripts individually:
- check:contract, check:neon-egress, check:admin-ui, check:ui, check:imports, check:scheduling
- check:daily-refresh, check:enterprise-operations, check:unified-data-ingestion
- check:enterprise-analytics-phase-2, check:react, check:role-perspective
- test:score, check:brand, check:mlops, check:mlops-data-quality
- check:south-africa-compliance, check:period-comparison
Plus numerous isolated TS test files and JS checks listed in CircleCI verify; preserve their original boundaries.

## New security test coverage to implement and validate
- Real MFA/admin step-up negative tests (not just existence checks).
- Cross-tenant IDOR and role elevation tests.
- Route-specific rate limits and lockout protections.
- CSRF, SSRF, XSS, webhook signature and file upload checks.
- Rollback, restore and migration failure handling using synthetic DBs.
- Mobile viewport, accessibility, frontend/backend interoperability.
- Explicit deployment gating for Render + Cloudflare after approved CI only.

## Non-negotiable environment constraints
- Disposable local PostgreSQL fixture only; no Neon, Railway or production database.
- Never import provider secrets or production .env files; no secrets in Docker build context.
- Use dedicated Compose project names, and clean up only their resources.
- No GitHub-hosted runner, CircleCI paid job, or automatic PR execution on the personal self-hosted machine.
- Keep the three restricted Neon semantic workflow jobs disabled/not migrated into offline CI.
- No deployments or PR merges until tests, reports and policies are reviewed.

## Verification checklist
1. Static review of commands, fixture behavior and network egress.
2. Acquire approved scanner rules and vulnerability databases separately, with documented versions.
3. Run each job and preserve redacted reports even when a scanner fails.
4. Confirm Trivy DS-0002 resolves on **every** relevant Dockerfile.
5. Run complete suite on personal runner and compare against CircleCI command-by-command.
6. Require approved status before deployment; never imply CI pass is a deployment.
