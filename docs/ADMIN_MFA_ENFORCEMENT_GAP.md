# Administrator MFA enforcement — implementation gap

The current server `requireAdmin` guard checks ADMIN/SUPERADMIN roles but does not verify a fresh second factor. Existing security telemetry, sessions and audit events do not constitute MFA.

## Red test
Run `node --test tests/security/admin-mfa-readiness.test.mjs` inside the isolated Node Docker image. It is **expected to fail** until real MFA is implemented; do not add it to the passing CI suite or suppress its failure.

## Minimum implementation design
1. Enroll administrators using a phishing-resistant authenticator (WebAuthn/passkey preferred), with recovery flow and enrollment audit logs; consider TOTP as fallback if necessary.
2. Store credential public keys or protected TOTP seed material server-side; never expose enrollment secrets in log output, API responses or CI fixtures.
3. Keep an authenticated-but-not-MFA-verified session distinct from an MFA-verified session; use server-side proof bound to session ID and expiration.
4. Enforce step-up on sensitive state-changing administrator operations in the server, including source configuration, users/roles, session revocation, resets, MFA changes, and credential rotation.
5. Deny missing, expired, replayed, cross-session and cross-user proofs; rotate session identifiers after successful privilege elevation.
6. Test with synthetic enrollment and sessions against disposable DB, covering unauthenticated, ordinary user, admin without MFA, admin with expired MFA, and verified admin.
7. Stage review and a migration plan for existing admins before any production enforcement.

No live MFA credentials, email delivery, external APIs, cloud DB, deploys or production changes are authorized by this document.
