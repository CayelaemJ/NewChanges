# Administrator MFA — integration and staged rollout

## Implementation status
The application now contains passkey registration/authentication routes, a branded /mfa page, a session-rotating cryptographic verification path and an environment-controlled administrator authorization guard. **Do not enable enforcement until the dependency is committed and a real browser and recovery rehearsal has passed.** This is not yet a production rollout.

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
- The generated dependency was installed **temporarily in the CI checkout** and has **not yet been committed to the branch**. A passing run with `prepare_mfa_lock=true` is not yet evidence that an ordinary `npm ci` from a clean checkout will pass.
- Subsequent edits add Safari/iOS compatibility handling, matching Fixer purple styling and MFA-specific rate limits. These changes require a fresh green Docker run.
- Admin enforcement remains disabled by default, and production recovery is not ready.

## Before staging acceptance
1. Resolve `@simplewebauthn/server@14.0.3` through the npm registry, commit generated `package.json` and `package-lock.json` **together**; never hand-edit integrity hashes.
2. Run the signed synthetic registration/authentication test and the full isolated Docker CI.
3. Confirm the database migrations apply to disposable PostgreSQL.
4. Test real browser hardware/passkey enrollment, verification, session rotation, expired challenge, multiple admins, revoked credentials, password reset, lost device, and recovery.
5. Audit all non-`/api/admin/` state-mutating administrator routes and the separate frontends; enforce MFA consistently.
6. Confirm database backup/restore, rollback, session expiration, logging redaction and production migration plan.
7. Only then consider enabling the opt-in staging enforcement flag; production cutover requires explicit approval.

No direct deployment or credential use is part of this PR.
