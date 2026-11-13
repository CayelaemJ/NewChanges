# MFA operations and support runbook

**Current verified target:** Render standby, `https://newchanges-standby.onrender.com`  
**Current MFA release:** merged commit `5b3cef6b1b45ff6dadf8be45a88de3ebd6075992` (PR #247), deployed to Render standby on 2026-11-13.

This runbook describes the current account behavior and the operator steps to configure, deploy, support, and recover MFA. The Render standby verification is not a production cutover approval. Railway or any other service needs its own reviewed settings, database migration, backup and acceptance checks.

## Policy at a glance

- With `MFA_ENFORCE=true`, every signed-in role must complete MFA before accessing protected application pages and APIs. Login and MFA ceremony endpoints remain available to complete setup.
- During first-time setup, an account without an enrolled passkey can choose a device passkey or a standard authenticator app.
- **Once an account has an active passkey, that account is passkey-only.** The QR setup panel is hidden, and the server rejects TOTP setup, confirmation and verification for that account. This is intentional; do not troubleshoot the hidden QR as an outage.
- An account that has not enrolled a passkey may use standard TOTP. It uses a six-digit code that changes every 30 seconds and works with authenticator apps supporting standard TOTP.
- MFA verification is associated with the active session. “Remember me” can extend the session up to 30 days, but inactivity ends it after 7 days. A logout, revocation, session expiry or idle timeout requires a new sign-in and MFA verification.
- Superadmins must issue and save their one-time recovery key before entering the dashboard. The key is displayed once; the database stores only its hash.
- Sensitive administrator operations may require recent MFA verification. Superadmin recovery approvals require two distinct, independently passkey-verified superadmins.

## User flows

### Existing or new account without MFA

1. Sign in with the account password. The application sends the account to `/mfa`.
2. Confirm the current password for first-time enrollment.
3. Choose either:
   - **Device passkey:** Windows Hello, Face ID, Touch ID or a compatible FIDO2 security key.
   - **Authenticator app:** generate the private QR, scan it once with a standard TOTP authenticator app, then enter its current six-digit code.
4. Copy and securely store the one-time recovery key when shown, then acknowledge that it is saved.
5. Continue to the dashboard.

An administrator with no enrolled MFA factor can complete first-time enrollment by confirming their current password; this does not ordinarily require another superadmin to approve it. Security bootstrap or recovery grants are for exceptional, explicitly authorized cases.

### Account with an enrolled passkey

- Use **Verify passkey** at sign-in.
- The authenticator QR setup and TOTP verification controls are hidden.
- The API also rejects TOTP setup, confirmation and verification; hiding the controls is not the security boundary.
- A passkey user can manage or add passkeys on `/mfa/manage` after verifying their session. Adding a passkey keeps the account passkey-only.
- A hard refresh may be needed after a deployment if the browser cached the old page.

### Account using an authenticator app without a passkey

- Enter the fresh six-digit TOTP code at sign-in.
- Do not scan a new QR on routine sign-ins. The QR and manual setup key are shown only during initial enrollment and expire after 10 minutes.
- If a verified TOTP-only user later adds a passkey, the account changes to passkey-only behavior.

## Recovery

### Recovery key handling

The recovery key is separate from the TOTP encryption key. It is displayed once, cannot be retrieved by support, and must be stored in a trusted password manager or another secure location. Never paste recovery keys or authenticator setup secrets into chat, email, tickets, screenshots, Git or logs.

If a user has lost a key, the application can issue a replacement only after a fresh factor verification. Issuing a new key invalidates the old one.

### Regular account recovery

A non-administrator who has lost MFA can use the account password and one-time recovery key. The process revokes current MFA methods and active sessions; the user signs in again and enrolls a replacement factor.

### Administrator and superadmin recovery

Password-only recovery does not bypass administrator MFA. A different, identity-verified administrator must participate. The protected process requires two distinct superadmins to independently verify with passkeys; it revokes affected sessions and factors, then issues a temporary bootstrap grant through the application. Verify the target’s identity over a separate trusted channel and deliver a grant privately. Never approve your own recovery request.

If the affected superadmin is the only available passkey-verified superadmin, stop and follow the organization’s identity-verified break-glass procedure; do not disable MFA or change encryption secrets as a workaround.

## Render environment configuration

Configure these values on each intended service using the hosting provider’s protected environment-variable settings. Do not commit secrets or paste them into tickets.

| Variable | Required value or format | Notes |
|---|---|---|
| `MFA_ENFORCE` | `true` | Preferred switch; requires MFA for all account roles. The historical `ADMIN_MFA_ENFORCE` alias remains accepted. |
| `MFA_RP_ID` | `newchanges-standby.onrender.com` on the verified standby host | Hostname only; no scheme, port, path, query or trailing dot. Use the final hostname where users sign in. |
| `MFA_EXPECTED_ORIGIN` | `https://newchanges-standby.onrender.com` on the verified standby host | Exact HTTPS origin with no trailing slash or path. Must match the browser origin. |
| `ADMIN_MFA_TOTP_ENABLED` | `true` | Enables authenticator enrollment for accounts that do not have an active passkey. |
| `ADMIN_MFA_TOTP_ENCRYPTION_KEY` | Persistent random 32-byte key, unpadded base64url (43 characters) | Encrypts TOTP seeds at rest. Keep the same key across deploys and protect a recovery copy under the approved secret escrow process. Never include the value in documentation. |
| `COOKIE_SECURE` | `true` for public HTTPS | Keeps session cookies secure on HTTPS deployments. |

The RP ID and origin above apply only to the Render standby hostname. Use the exact final public hostname for each separate deployment before enrolling real users. Changing the passkey RP ID or origin can make enrolled passkeys unusable.

The encryption key is not a password, recovery key, session key or database credential. Losing it, or replacing it without a planned re-encryption, makes existing TOTP factors unverifiable. Before changing it, inventory encrypted TOTP records, obtain a protected backup and follow a reviewed key-rotation procedure. Do not generate a replacement as a casual troubleshooting step.

In writable production, startup checks require MFA enforcement and valid TOTP encryption configuration. Keep TOTP configuration valid even when a particular account is passkey-only, because other accounts may choose TOTP at first enrollment.

## Database and release procedure

1. Confirm the application commit and target service. Render standby and Railway production are separate deployments.
2. Confirm a recent backup and a tested restore path before database changes.
3. Apply the checked-in Prisma migrations through the approved deployment step (for example, `npm run db:deploy`) against the intended database only. Check `npx prisma migrate status` afterward.
4. Set and review the MFA environment variables in the hosting dashboard. Keep secrets out of shell command arguments and deployment logs.
5. Deploy the application. Confirm the deployment is live and `GET /health` returns success.
6. Sign in with disposable accounts representing each role. Check enrollment, recovery-key acknowledgement, passkey-only behavior, TOTP-only setup where applicable, remembered sessions and protected-route denial before MFA.
7. Do not route production traffic or declare a cutover based only on this standby release or its CI checks.

Never use `prisma db push` or a destructive database reset for a production migration.

## Troubleshooting

| Symptom | Check |
|---|---|
| QR option is absent after a passkey was enrolled | Expected passkey-only policy. Use the enrolled passkey. |
| QR setup returns a conflict for a passkey account | Expected server-side enforcement. Do not try to bypass it with a direct request. |
| TOTP setup returns a server error for a no-passkey account | Confirm `ADMIN_MFA_TOTP_ENABLED=true` and that `ADMIN_MFA_TOTP_ENCRYPTION_KEY` is a valid persistent 43-character base64url value. Check sanitized Render logs; never log the key or TOTP seed. |
| Passkey setup reports origin or RP ID mismatch | Check the public hostname in the browser against `MFA_RP_ID` and `MFA_EXPECTED_ORIGIN`; both must match the final deployment origin. |
| A remembered session asks for MFA again | Check whether the user logged out, the session was revoked, 30-day expiry was reached, or the account was idle for more than 7 days. |
| Recovery key is not shown again | Expected. It is one-time display; issue a replacement only after fresh factor verification or follow the administrator recovery process. |

## Current release evidence and boundaries

As of 2026-11-13:

- PR #247 merged as `5b3cef6b1b45ff6dadf8be45a88de3ebd6075992`.
- Render standby deployment `dep-dbrgiim1egvs73fqgj50` reported live.
- CircleCI verify, both browser smoke checks, source quality, Semgrep, Trivy, dependency audit, credential exposure scan and Gitleaks reported success.
- Snyk could not run because the account had exhausted its credits.
- This records the standby release only; it does not assert that Railway production is configured, migrated or approved for cutover.
