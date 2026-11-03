# The Fixer — authenticator app (TOTP) and existing-admin MFA rollout

Status: **draft PR #219 / isolated synthetic staging only**. Do not enable production without required security tests, grant issuance, rollback approval and an approved backup/restore procedure.

**Update (2026-11-03):** Normal new/existing administrator onboarding now uses server-managed session-bound approval without users typing 43-character grants. See `docs/ADMIN_MFA_SERVER_MANAGED_ENROLLMENT.md`. The grant flow below is retained only for guarded bootstrap and account recovery.

## Expected administrator experience

Every new or existing `ADMIN` / `SUPERADMIN` is subject to the same `ADMIN_MFA_ENFORCE=true` gate. A password alone cannot open the dashboard or privileged APIs. Upon sign-in, an unverified admin is redirected to `/mfa` and must do one of:

1. **Passkey** — use device verification (Windows Hello, a supported password manager or a hardware key) and an approved first-enrollment grant.
2. **Authenticator app** — choose **Show QR code to scan**, open Google Authenticator/Microsoft Authenticator (or any RFC 6238 compatible app), use Add Account → Scan QR code, and enter the current 6-digit number to activate. A manually entered secret is offered if scanning is unavailable. The QR and secret are one-time provisioning material, NOT QR sign-in.

Future password sign-ins take admins to `/mfa` again to verify their enrolled passkey or enter the current 30-second app code. Users may enroll a second method once they already have recent MFA, but must not silently replace an enrolled factor. Ordinary user roles are not forced into this admin-only change.

**Security boundary:** Authenticator codes satisfy standard administrator MFA for day-to-day access, but TOTP is phishing-susceptible. Existing two-superadmin account recovery **continues to require a freshly verified PASSKEY from each of two different SUPERADMIN users**. Both approvers and the target must be distinct; recovery revokes target passkeys, TOTP secrets and sessions before issuing a single short-lived grant.

## Required secrets and schema

- `ADMIN_MFA_TOTP_ENABLED=true` only after a migration and successful synthetic testing.
- `ADMIN_MFA_TOTP_ENCRYPTION_KEY`: **new, unique, CSPRNG-generated 32-byte base64url** value, stored only in the deployment's protected environment and backed up in an approved secrets vault. Never commit, email, reuse production keys in staging, or paste into chat.
- Database: additive `AdminMfaTotp` model and `Session.mfaMethod`. The schema stores AES-256-GCM encrypted pending and active seeds, a provisioning expiry, the last accepted time-step, and per-account failed-attempt lockout state.
- The locked `qrcode-generator@2.0.4` library renders SVG QR data locally on the backend. The otpauth URI never leaves the app for a remote QR-image generator.
- QR responses are `no-store`; the plain secret is visible only during setup. Codes and secrets must never appear in audit logs.

**Key loss is a serious operational incident:** encrypted TOTP seeds become unusable if the key is lost. Before production rollout, verify backup access and a rehearsed independent administrator recovery procedure. Do not rotate the key without a planned re-encryption migration.

## Existing administrator onboarding — no account lockouts

- Inventory all current active `ADMIN` and `SUPERADMIN` users. This change applies to them without changing roles or creating accounts.
- Before enforcing MFA in production, ensure **at least two independently passkey-enrolled superadministrators** can perform the existing two-person recovery flow.
- Distribute separately approved, individually unique, time-limited first-enrollment grants to administrators through a verified channel. Do not add a blanket password-only self-enrollment backdoor: a stolen admin password must not be sufficient to bind an attacker's device.
- The existing independent two-superadministrator recovery flow can issue a replacement enrollment grant for an existing administrator, including users without a current factor. The operator must verify identity out of band first. Initial superadministrator bootstrap needs a separate, approved security-owner procedure, **never an automatically enabled production flag**.
- Communicate the go-live date, grant expiry, supported authenticator apps, passkey alternatives and recovery contact before enforcement. A dry run and rollback plan are mandatory.
- Once staging tests pass and grants are ready, switch `ADMIN_MFA_ENFORCE=true` for production **only on separate explicit approval**; all already-signed-in admin sessions without a fresh factor will be blocked from the protected dashboard and privileged operations.
- Confirm each admin can enroll, confirm a 6-digit code, log out, sign back in, and verify a fresh code. Do not remove enforcement to support a failed setup; use the approved recovery process.

## Tests / acceptance criteria

- Automated RFC 6238 SHA1 vectors, AES-GCM roundtrip and tamper rejection, per-user unique seeds, server-only QR SVG generation.
- Invalid/missing grant refuses enrollment; expired or invalid QR confirmation cannot enable a factor.
- Correct 6-digit code confirms enrollment, rotates session and records only non-sensitive audit metadata.
- A code is **single-use** (persisted lastUsedStep) and invalid/wrong codes trigger a persistent per-account throttle/lock, never raw-code logging.
- Password-only sessions are redirected to `/mfa`; direct `/dashboard`, `/react`, `/admin`, `/users` and privileged APIs cannot bypass enforcement.
- A freshly verified TOTP lets an eligible administrator use routine console functions; two-person recovery **refuses TOTP-only superadmin sessions**.
- Two verified superadmins approve target recovery; the target's TOTP enrollment, passkeys and sessions are revoked atomically, and the single-use grant lets them enroll a replacement factor.
- QR scans using Google Authenticator and Microsoft Authenticator on physical devices; verify behavior across web-service sleep with persistent PostgreSQL.
- Latest self-hosted Docker CI must be green on the exact PR head. Confirm Render staging build and physical-device test evidence separately; do not merge based only on one successful build.

## Rollback / deployment discipline

Use only the separate free `newchanges-mfa-isolated-staging` (not `newchanges-standby`) for testing. Keep manual deploys and manual Blueprint sync. No new paid services, no production DB data, and no pre-emptive production changes. If provisioning fails, leave MFA feature disabled in production, inspect logs, and fix staging. There is **no automatic deletion of current users**.
