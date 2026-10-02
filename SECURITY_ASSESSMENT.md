# EFS Optimise Enterprise Security Assessment

Date: 30 September 2026
Scope: EFS Optimise application, production deployment architecture, authentication/session controls, admin APIs, security telemetry, PostgreSQL application access, and security monitoring.

## Assessment basis

This review is aligned conceptually with OWASP ASVS 5.0 and the OWASP Web Security Testing Guide, and organised using the six functions of NIST Cybersecurity Framework 2.0: Govern, Identify, Protect, Detect, Respond, Recover.

This is an engineering security assessment, not a certification and not a substitute for an independent penetration test.

## Verified controls

### Govern
- Administrative actions are recorded in an append-only application audit model.
- High-impact and unusually frequent administrative actions can generate security alerts.
- User/employer access is separated from authentication.
- Security telemetry and session revocation are exposed only to administrators.

### Identify
- Users, employers, roles and employer access links are explicit application entities.
- Login events retain authentication outcome and security context.
- Sessions retain lifecycle state, device/browser/OS information and network context.
- Sensitive application API access is now recorded through DataAccessEvent.
- Database security telemetry exposes safe read-only health information.

### Protect
- Passwords use memory-hard scrypt hashing.
- Session tokens are hashed before persistence.
- Session revocation is supported for individual sessions and all sessions for a user.
- State-changing cookie-authenticated requests have same-origin protections.
- Authentication and API rate limiting exist.
- Security response headers and CSP are enabled.
- Admin routes are server-side authorization gated.
- Sensitive database operations are not exposed as arbitrary SQL through the admin UI.
- Security telemetry never relies on Railway edge location as if it were user location.

### Detect
- Failed login burst detection.
- New-device detection.
- New IP-derived location detection.
- High-impact admin action detection.
- Admin activity spike detection.
- Device grouping across sessions.
- IP-derived approximate geography with a cache.
- Sensitive application-data access audit trail.
- Open/resolved security alert lifecycle.

### Respond
- Individual session revocation.
- Revoke all sessions for a user.
- Account disable/deactivation controls already exist.
- Security alerts can be resolved by administrators.
- Admin actions carry actor and request context.

### Recover
- Historical user revocation records are retained.
- Security telemetry has bounded retention tooling.
- Railway deployment and database health can be independently inspected.
- Database destructive actions are deliberately not exposed through the application security UI.

## Security operations layers

1. Identity and authentication
2. Session and device intelligence
3. IP-derived approximate geography
4. Login anomaly detection
5. Admin activity monitoring
6. Sensitive data access monitoring
7. Database health and control visibility
8. Security alert management
9. Audit trail and accountability
10. Deployment and infrastructure monitoring

## Important limitations / remaining enterprise controls

The following status is based on repository evidence only. A feature or procedure is not complete until its production configuration and evidence are recorded. `PARTIAL` means some application or repository groundwork exists, not that the operational control is effective.

| # | Control | Status | Evidence in this repository | Closure evidence required |
|---|---|---|---|---|
| 1 | External security test | OPEN | This assessment contains a proposed test scope; it explicitly says no independent test has been performed. | Dated report from an independent tester, authorized scope and production perimeter, findings owner/severity, remediation evidence, and retest results. Track unresolved critical/high findings as a release blocker. |
| 2 | Admin MFA | OPEN | Admin routes require application authentication; no MFA implementation or identity-provider enforcement is evidenced in source. | Enforced MFA for every administrator, tested enrollment and recovery, factor-change session revocation, and documented break-glass access. Verify enforcement at the identity boundary, not only in the UI. |
| 3 | Backup and restore | OPEN | The release runbook requires a restore test, but no completed restore record or measured RPO/RTO is present. | Restore a production-like backup into an isolated environment; record backup timestamp, restore completion, integrity/application checks, measured RPO/RTO, and approver. |
| 4 | Production monitoring and alerting | PARTIAL | `/health`, `/version`, application security alerts, and optional email/Slack notification paths exist. Production uptime, error, database, and delivery alert configuration is not verified here. | Monitoring coverage and thresholds documented; trigger a controlled test for each critical alert and retain delivery/acknowledgement evidence, escalation owner, and runbook link. |
| 5 | Centralised security logging | PARTIAL | Application audit and security-event records exist. Central SIEM forwarding and immutable off-platform retention are explicitly outstanding. | Demonstrate redacted event forwarding, reliable delivery, access controls, retention/immutability, time correlation, and an alert/query against a test event. Never send credentials, tokens, or request bodies. |
| 6 | Secrets and credential rotation | OPEN | `SECURITY.md` and deployment guidance place secrets in Railway variables; there is no complete inventory, rotation schedule, or rotation evidence. | Inventory each production credential with owner, purpose, storage, expiry/rotation interval, and last-rotated date; rotate and revoke a test credential using the documented procedure and verify dependent services recover. |
| 7 | Dependency updates | PARTIAL | Daily npm, Docker, and GitHub Actions Dependabot update automation is configured. Current open updates, successful lockfile/build validation, and audit status are not verified in this assessment. | Review and merge applicable Dependabot/security updates; run `npm ci`, `npm run build`, `npm run check:all`, and resolve or formally disposition every high/critical audit finding. Record exceptions with owner and expiry. |
| 8 | Mobile, desktop, and business-data end-to-end testing | PARTIAL | Static UI/accessibility/performance/regression checks and a release smoke checklist exist. No recorded browser-based end-to-end run against representative business data is present. | Retain a browser test report across desktop, tablet, phone portrait, and phone landscape, plus a data-reconciliation report covering filters, periods, missing data, and key dashboard totals. |
| 9 | Independent reporting validation | OPEN | Reporting semantics and source-reconciliation requirements are documented; no independent reviewer sign-off or recurring validation record is present. | A reviewer independent of report implementation reconciles selected periods, cohorts, and totals to authoritative source data, records discrepancies and resolution, and signs off before release. |

Other outstanding enterprise controls include PostgreSQL role separation and least-privilege accounts, row-level security where required, encryption/key-management review, data classification and minimisation, incident response and breach-notification playbooks, authenticated perimeter scanning, Railway permission review, and a formal privacy impact assessment/retention schedule. These also require separate implementation or operational evidence.

## Penetration testing plan

The external test should cover:

- TLS and security-header configuration
- Authentication and password-reset flows
- Session fixation, theft and revocation
- Authorization and horizontal/vertical privilege escalation
- Employer-to-employer data isolation
- Admin endpoint authorization
- IDOR/BOLA testing
- CSRF
- XSS
- SQL injection
- SSRF
- file upload/parser attacks
- rate-limit bypass
- business-logic abuse
- mass assignment
- error and information disclosure
- API enumeration
- logout/session invalidation
- password-reset token abuse
- account takeover paths
- sensitive data exposure
- cache-control and browser storage
- deployment/configuration exposure

Use OWASP WSTG as the test methodology and ASVS as the control verification baseline.

## Database security policy direction

The application should treat the PostgreSQL database as a protected system of record.

The admin application should provide visibility and controlled actions, but should not provide arbitrary SQL execution.

Recommended production model:

- application runtime account: least privilege
- migration account: separate elevated credentials
- read-only reporting account where required
- no shared personal database credentials
- secrets stored only in Railway variables/secrets
- audit application access to sensitive API surfaces
- monitor failed database authentication
- monitor connection spikes
- test backup restoration
- document retention/deletion controls
- periodically review privileged database users
- avoid storing unnecessary raw PII
- use stable/tokenised external identifiers where possible

## Current assessment status

The security foundation is substantially stronger than a basic CRUD admin portal, but the system should not be described as independently penetration-tested or formally compliant until the remaining controls and external testing are completed.

The new Security Operations layer is designed to make those gaps visible and manageable from the admin experience rather than hiding them.

## References

- OWASP Application Security Verification Standard: https://owasp.org/projects/asvs
- OWASP Web Security Testing Guide: https://owasp.org/projects/web-security-testing-guide
- NIST Cybersecurity Framework 2.0: https://www.nist.gov/publications/nist-cybersecurity-framework-csf-20
