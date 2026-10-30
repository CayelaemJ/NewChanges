# NewChanges CI migration coverage

This manifest is a **target plan**, not evidence that tests have run. Never mark passing unless a job reports success.

## Existing standard CircleCI jobs
- verify (Node/build; disposable PostgreSQL; RLS cross-tenant probe; semantic/source safeguards; contract; API/dashboard; data quality)
- source_quality (ESLint; password forms; TypeScript; Vitest)
- admin_browser_smoke
- browser_smoke (Playwright, UX and responsive browser checks)
- semgrep_security
- credential_exposure_scan
- dependency_advisory_audit
- gitleaks_history_scan (redacted full history)
- trivy_vulnerability_scan

## Local Docker checks observed in the user's working tree
- quality:lint; password-form-contract; quality:types; quality:unit; build
- check:production; check:security; check:security-identity; check:security-operations
- check:security-governance; check:accessibility; check:performance
- check:semantic-planner; check:semantic-storage
- check:source-vault; check:source-continuity; check:source-reconciliation
- scripts/security/rls-isolation-ci-probe.mjs (synthetic DB only)
- scripts/prisma-upgrade-integration.mjs (synthetic DB only)
- quality:e2e; console UX; responsive header; admin browser smoke

## New coverage to implement and validate
- MFA mandatory for admins; step-up for privileged modifications; recovery/lockout
- negative role/tenant tests (IDOR, row-level access, forbidden cross-tenant reads/writes)
- rate limiting: admin/auth/password-reset/ingest/report/sync endpoints
- CSRF, XSS, SSRF, file upload validation, security headers, session expiry
- data import idempotency, retry/recovery, concurrent operations and rollback
- health/version endpoints, offline API smoke, downtime/rollback release checks
- responsive browser flows: desktop, tablet and phone; WCAG AA
- dependency and container vulnerability checks
- audit logs, backup/restore with synthetic database

## Security/architecture constraints
- Workflow dispatch only; no automatic PR/push triggers until fully reviewed.
- Only trusted code on Docker-enabled personal runner; no arbitrary PRs.
- No cloud testing databases and no deployed service credentials.
- Docker Compose runtime should use an internal network and disposable named volumes.
- Docker build is not automatically offline. Audit install dependencies and image build context first.
- Separate build-time scanners/tools from offline runtime suite; pre-cache/pin scanners and feeds where practicable.
- Do not invoke optional CircleCI Neon workflows in the local suite.
- CI test completion alone does not deploy Render or Cloudflare.
- Never accept an empty/missing test group as passing.
