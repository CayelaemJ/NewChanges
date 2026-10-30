# Administrator MFA — integration and staged rollout

## Implementation status
The application now contains passkey registration/authentication routes, a branded /mfa page, a session-rotating cryptographic verification path and an environment-controlled administrator authorization guard. **Do not enable enforcement until the committed dependency passes a clean-checkout run, and real-browser and recovery rehearsals pass.** This is not yet a production rollout.

## Required runtime settings
- `MFA_RP_ID`: exact relying-party domain, such as `staging.example.com`; never derive from a user-supplied Host header.
- `MFA_EXPECTED_ORIGIN`: exact secure origin, such as `https://staging.example.com`, with no path.
- `ADMIN_MFA_ENFORCE`: defaults to false. Enable only in an isolated staging deployment after review and approved admin recovery is in place.
- `COOKIE_SECURE`: true on HTTPS deployments.

## Server endpoints
- `GET /mfa`: administrator passkey UX.
- `GET /api/auth/mfa/status`: authenticated user's enrolled/verified state.
- `POST /api/auth/mfa/register/options` and `/verify`: require a recent passkey verification or one-time grant; all attestation responses are checked by SimpleWebAuthn.
- `POST /api/auth/mfa/authenticate/options` and `/verify`: verify a signed assertion, require user verification and atomic counter/challenge update, and rotate the session token.
- When `ADMIN_MFA_ENFORCE=true`, the shared administrator guard and all `/api/admin/` operations require recently verified passkey proof; admin and users pages redirect to /mfa.
- **There are no public password-only enrollment or recovery bypass routes.**

## First enrollment (synthetic disposable local DB only)
A controlled local operator script issues one-time 10-minute enrollment grants:
`MFA_OPERATOR_ACTION=enroll`, `MFA_TARGET_EMAIL`, `MFA_APPROVER_ONE`, `MFA_APPROVER_TWO`.
Script: `scripts/mfa-local-operator.ts`. This script **refuses all database URLs except** the disposable test fixture URL and requires `CI_RLS_PROBE_APPROVED=CI_DISPOSABLE_ONLY`. The two approver names are an *operator assertion* and must be independently verified outside the application. They are not independently cryptographically authenticated by this script.

## Recovery (synthetic disposable local DB only)
Under separately approved, independently checked two-person recovery: use `MFA_OPERATOR_ACTION=recover` with the same controlled fixture script. It revokes all user passkeys and sessions, clears pending challenges, issues a one-time replacement grant and writes an admin audit record. The user signs in again with their original account password, then enrolls a new passkey with the grant. This utility cannot access production. Production recovery requires a separately reviewed and implemented privileged operator workflow, secure approval evidence, and incident response.

## Verified CI evidence (2026-10-30)
- Workflow run [41050588341](https://github.com/CayelaemJ/NewChanges/actions/runs/41050588341) completed successfully with the opt-in lock preparation and security scanners.
- The synthetic signed WebAuthn registration/authentication round-trip passed, with **39/39 MFA tests** in that run.
- The genuine npm-generated lockfile artifact is **12974152364** (`newchanges-mfa-locked-dependency-41050588341`), holding `package.json` and `package-lock.json` with `@simplewebauthn/server@14.0.3`.
- Both registry-generated dependency files have now been committed to draft PR #219 (commit `979d5884`). The previous successful run used `prepare_mfa_lock=true`; a new run with that option **unchecked** is still needed to prove that a clean-checkout `npm ci` passes.
- Subsequent edits add Safari/iOS compatibility handling, matching Fixer purple styling and MFA-specific rate limits. These changes require a fresh green Docker run against the committed files.
- Admin enforcement remains disabled by default, and production recovery is not ready.

## Two-verified-superadmin recovery (staged, not yet production approved)
Two different active SUPERADMIN users must independently verify passkeys within the freshness window. The target administrator cannot be either approver. Never accept a password-only approval or browser-provided verification flag.

1. First approver calls `POST /api/admin/mfa/recovery/request` with `{"targetUserId":"<existing-user-id>"}`. This returns a request ID valid for 15 minutes and records an auditable request.
2. After independently confirming the target administrator's identity **out of band**, a different passkey-verified SUPERADMIN calls `POST /api/admin/mfa/recovery/<request-id>/approve`.
3. In a single database transaction, the application consumes the request, revokes the target's existing passkeys and sessions, deletes pending challenges, invalidates unspent enrollment grants, creates a fresh 10-minute hashed grant, and writes the audit event.
4. The approving superadmin receives the raw grant **once** in the response. It is not persisted, emailed automatically, or written to application logs. They must securely deliver it to the identity-verified target outside the app.
5. The target signs in again with their own password and enrolls a replacement passkey at `/mfa`. A password reset alone cannot remove MFA.

This route provides no self-service bypass. If fewer than two passkey-verified superadmins remain available, this workflow cannot recover the account. A separate out-of-band emergency recovery procedure, authorised and tested by the business, is required before production MFA enforcement. Identity checks and secure code delivery are human operational controls, not automatically verified by the API. Rollout remains opt-in and disabled by default.

## Before staging acceptance
1. **Completed:** `@simplewebauthn/server@14.0.3` is pinned in both committed npm-generated dependency files. Validate clean-checkout reproducibility with **Prepare MFA lock unchecked**.
2. Run the signed synthetic registration/authentication test and the full isolated Docker CI.
3. Confirm the database migrations apply to disposable PostgreSQL.
4. Test real browser hardware/passkey enrollment, verification, session rotation, expired challenge, multiple admins, revoked credentials, password reset, lost device, two-verified-superadmin recovery and independent target identity verification.
5. Confirm all non-`/api/admin/` state-mutating administrator routes and the separate frontends enforce MFA consistently; the route-scope tests now cover administrator API mutations.
6. Confirm database backup/restore, rollback, session expiration, logging redaction and production migration plan.
7. Only then consider enabling the opt-in staging enforcement flag; production cutover requires explicit approval.

No direct deployment or credential use is part of this PR.
