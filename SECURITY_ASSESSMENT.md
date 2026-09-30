# NewChanges Enterprise Security Assessment

Date: 30 September 2026
Scope: NewChanges application, production deployment architecture, authentication/session controls, admin APIs, security telemetry, PostgreSQL application access, and security monitoring.

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

These are not claimed as complete until separately implemented and tested:

- MFA / phishing-resistant authentication for administrators
- Centralised SIEM integration and immutable off-platform log retention
- Formal secrets rotation and secret inventory
- Formal database backup restore testing
- PostgreSQL role separation and least-privilege database accounts
- Row-level security where tenant isolation requires database-enforced boundaries
- Encryption/key-management review for data at rest and backups
- Data classification and field-level minimisation for client PII
- Formal incident response playbooks and breach notification procedures
- Independent external black-box penetration test
- Authenticated vulnerability scanning against the production perimeter
- Dependency/SCA policy with a defined remediation SLA
- Infrastructure configuration review for Railway workspace/project permissions
- Formal privacy impact assessment and retention schedule
- Admin MFA recovery and break-glass procedures

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
