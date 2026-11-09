# The Fixer — authenticator app (TOTP) and all-account MFA rollout

Status: **draft PR #219 / isolated synthetic staging only**. Do not enable production without required security tests, grant issuance, rollback approval and an approved backup/restore procedure.

**Scope update (2026-11-09):** Enforcement now applies to every active account role. Regular users enroll by confirming their current password; administrator first-time enrollment retains separate, identity-verified approval. See `docs/ADMIN_MFA_SERVER_MANAGED_ENROLLMENT.md`.

## Expected account experience

Every new or existing active account is subject to the `MFA_ENFORCE=true` gate. The historical `ADMIN_MFA_ENFORCE=true` name remains an alias and now has the same all-account effect. A password alone cannot open protected pages or APIs. Upon sign-in, an unverified account is redirected to `/mfa` and must do one of:

1. **Passkey** — use device verification (Windows Hello, a supported password manager or a hardware key). Regular users confirm their password for first enrollment; administrators also require separately approved enrollment authorization.
2. **Authenticator app** — choose **Show QR code to scan**, open Google Authenticator/Microsoft Authenticator (or any RFC 6238 compatible app), use Add Account → Scan QR code, and enter the current 6-digit number to activate. A manually entered secret is offered if scanning is unavailable. The QR and secret are one-time provisioning material, NOT QR sign-in.

Future password sign-ins take every account to `/mfa` to verify an enrolled passkey or enter the current 30-second app code. Users may enroll a second method once they already have recent MFA, but must not silently replace an enrolled factor. Regular users can recover their own factors using their current password and one-time recovery key; administrators continue to use dual-superadministrator recovery.

**Security boundary:** Authenticator codes satisfy standard account MFA for day-to-day access, but TOTP is phishing-susceptible. Administrator recovery **continues to require a freshly verified PASSKEY from each of two different SUPERADMIN users**. Both approvers and the target must be distinct; recovery revokes target passkeys, TOTP secrets and sessions before issuing a single short-lived grant.

## Required secrets and schema

- `ADMIN_MFA_TOTP_ENABLED=true` only after a migration and successful synthetic testing.
- `ADMIN_MFA_TOTP_ENCRYPTION_KEY`: **new, unique, CSPRNG-generated 32-byte base64url** value, stored only in the deployment's protected environment and backed up in an approved secrets vault. Never commit, email, reuse production keys in staging, or paste into chat.
- Database: additive `AdminMfaTotp` model and `Session.mfaMethod`. The schema stores AES-256-GCM encrypted pending and active seeds, a provisioning expiry, the last accepted time-step, and per-account failed-attempt lockout state.
- The locked `qrcode-generator@2.0.4` library renders SVG QR data locally on the backend. The otpauth URI never leaves the app for a remote QR-image generator.
- QR responses are `no-store`; the plain secret is visible only during setup. Codes and secrets must never appear in audit logs.

**Key loss is a serious operational incident:** encrypted TOTP seeds become unusable if the key is lost. Before production rollout, verify backup access and a rehearsed independent administrator recovery procedure. Do not rotate the key without a planned re-encryption migration.

## Account onboarding — no account lockouts

- Inventory all active accounts across roles before enforcement. Existing enrolled factors remain account-bound and are not replaced by the scope change.
- Regular users can self-enroll after confirming their current password and receive a one-time recovery key. Their self-recovery requires both that password and the one-time key, then revokes old factors and sessions.
- Before enforcing MFA in production, ensure **at least two independently passkey-enrolled superadministrators** can perform the existing two-person recovery flow.
- Administrators still require separately approved, individually unique, time-limited first-enrollment authorization through a verified channel. A regular-user password flow does not apply to administrator accounts.
- The existing independent two-superadministrator recovery flow can issue a replacement enrollment grant for an existing administrator, including users without a current factor. The operator must verify identity out of band first. Initial superadministrator bootstrap needs a separate, approved security-owner procedure, **never an automatically enabled production flag**.
- Communicate the go-live date, grant expiry, supported authenticator apps, passkey alternatives and recovery contact before enforcement. A dry run and rollback plan are mandatory.
- Once staging tests pass and all onboarding/recovery prerequisites are ready, switch `MFA_ENFORCE=true` for production **only on separate explicit approval**; all already-signed-in sessions without a fresh factor will be blocked from protected pages and APIs.
- Confirm users across roles can enroll, confirm a 6-digit code, log out, sign back in, and verify a fresh code. Do not remove enforcement to support a failed setup; use the correct recovery process for the account type.

## Tests / acceptance criteria

- Automated RFC 6238 SHA1 vectors, AES-GCM roundtrip and tamper rejection, per-user unique seeds, server-only QR SVG generation.
- Regular-account enrollment requires the correct current password; administrator enrollment still requires approved authorization; expired or invalid QR confirmation cannot enable a factor.
- Correct 6-digit code confirms enrollment, rotates session and records only non-sensitive audit metadata.
- A code is **single-use** (persisted lastUsedStep) and invalid/wrong codes trigger a persistent per-account throttle/lock, never raw-code logging.
- Password-only sessions are redirected to `/mfa`; direct `/dashboard`, `/react`, `/admin`, `/users` and privileged APIs cannot bypass enforcement.
- Fresh MFA is required for every role on protected application APIs and pages; two-person administrator recovery **refuses TOTP-only superadmin sessions**.
- Two verified superadmins approve target recovery; the target's TOTP enrollment, passkeys and sessions are revoked atomically, and the single-use grant lets them enroll a replacement factor.
- QR scans using Google Authenticator and Microsoft Authenticator on physical devices; verify behavior across web-service sleep with persistent PostgreSQL.
- Latest self-hosted Docker CI must be green on the exact PR head. Confirm Render staging build and physical-device test evidence separately; do not merge based only on one successful build.

## Rollback / deployment discipline

Use only the separate free `newchanges-mfa-isolated-staging` (not `newchanges-standby`) for testing. Keep manual deploys and manual Blueprint sync. No new paid services, no production DB data, and no pre-emptive production changes. If provisioning fails, leave MFA feature disabled in production, inspect logs, and fix staging. There is **no automatic deletion of current users**.
