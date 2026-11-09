# The Fixer: account MFA enrollment and administrator approval

Status: draft PR #219. **Not yet approved for production enforcement**. Test on
the disposable CI PostgreSQL service and isolated Render MFA staging only.

## User experience

1. Every account signs in with its existing application password.
2. If MFA is already enrolled, the browser offers a current six-digit authenticator
   code or an enrolled WebAuthn passkey. No enrollment approval is required.
3. If no MFA method is enrolled, `/mfa` offers the appropriate first-time path:
   regular users confirm their current password; administrators request
   identity-verified approval. The server creates a random database request ID
   for administrator approval and does **not** return a 43-character enrollment
   code to the user.
4. The user shares the non-secret request ID with the organization's security
   administrators only. Identity must be checked independently by both approvers
   before they attest to their approval. A password alone cannot authorize
   first-factor setup.
5. Two **different** SUPERADMIN users who have themselves recently
   authenticated with WebAuthn passkeys approve in **Admin console → Manage
   my MFA & passkeys** (/mfa/manage). Neither can be the target account.
6. The administrator clicks **Check approval status**. On approval, `/mfa`
   enables **Generate my one-time setup QR code** or **Set up device passkey**.
   Regular users proceed after password confirmation. Enrollment completes by
   verifying an actual TOTP code or signed WebAuthn registration assertion.
   Administrator approval is consumed atomically.
7. Later logins for every role ask for the enrolled TOTP code or passkey before
   protected access. Adding another method requires fresh MFA at `/mfa/manage`.

## Security properties

- Request ties to the exact user ID AND active session ID, expires after
  30 minutes and cannot authorize another login session.
- Each independent approval requires a passkey-verified SUPERADMIN session,
  a distinct approver and explicit confirmation of an external identity check.
- Audit entries record request and approvals without saving a raw grant.
- No plaintext enrollment code or TOTP seed is saved in browser localStorage
  or logged; all authenticator secrets remain AES-256-GCM encrypted in Postgres.
- Registered TOTP/passkeys cannot be silently replaced; approved recovery
  continues to use the distinct two-superadmin recovery procedure.
- Revoked, expired or ended sessions cannot complete MFA enrollment.
- The first two superadmin passkeys require an explicitly provisioned and
  verified *bootstrap* procedure. The legacy one-time grant remains available
  only under the Bootstrap/recovery disclosure. Do **not** convert a password
  alone into automatic first-factor enrollment for existing admins.
- The server encryption key ADMIN_MFA_TOTP_ENCRYPTION_KEY must remain a
  stable 32-byte secret for the environment, protected by the secret manager
  and backup policy. It is NOT a per-user enrollment code.

## Deployment and acceptance

- Apply the additive AdminMfaEnrollmentRequest Prisma migration to a
  disposable PostgreSQL database in offline self-hosted Docker CI first.
- Verify the full script scripts/ci/run-docker-ci-suite.sh passes on the PR
  head. It exercises browser enrollment, denied password-only access,
  two independent approvals, session binding and approval consumption.
- Deploy only the isolated Render MFA preview after the tests pass.
  Verify the staging service uses its existing managed, synthetic Postgres
  and retains the same staging encryption key across redeploys.
- Verify: password → request → first approval (still blocked) → second
  approval → QR/passkey → dashboard; logout/password → existing factor
  → dashboard. A different password session cannot consume approval.
- Do not migrate production users, enable production ADMIN_MFA_ENFORCE or
  change the production database as part of this PR review.
