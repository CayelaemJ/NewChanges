# Administrator MFA runbook

## Policy

Every `ADMIN` and `SUPERADMIN` must enroll a TOTP authenticator before using administrator pages or APIs. Admin sessions must complete MFA every 12 hours. Each recovery code works once. TOTP is not phishing resistant; plan a WebAuthn/passkey upgrade for administrators who need the stronger phishing-resistant factor.

## Deployment

1. Add `MFA_ENCRYPTION_KEY` to the production Render service as a secret before enabling enrollment. Generate it in a trusted shell with `openssl rand -hex 32`. Do not paste it into GitHub, chat, tickets, or logs.
2. Keep that key stable and backed up in the approved secret manager. Existing encrypted TOTP secrets cannot be decrypted if the key is lost. Key rotation requires re-encrypting all enrolled secrets before replacing the old key.
3. Deploy the app and run the repository's normal non-destructive Prisma schema sync (`npm run db:deploy` / the configured deployment hook). Do not manually reset the database.
4. Have every administrator sign in, enroll an authenticator app, verify a code, and save the displayed recovery codes.
5. Confirm the security assessment and release checklist only after CI and controlled production checks pass.

## Recovery

An admin can use one unused recovery code at login. The code is consumed atomically and cannot be used twice. After signing in with a recovery code, the admin can enroll a replacement authenticator; this revokes the user's other sessions and replaces old recovery codes.

If all authenticators and recovery codes for every administrator are lost, use the organization's approved database break-glass procedure with dual authorization and an auditable change record. Clear the affected user's MFA enrollment and recovery codes, revoke all sessions, and require re-enrollment. Do not add an application route that bypasses MFA.

## Verification checklist

- Unenrolled ADMIN and SUPERADMIN accounts cannot access any `/api/admin/*` route.
- Password-only sessions cannot access any `/api/admin/*` route.
- Correct TOTP works; wrong, expired, and replayed codes fail.
- Recovery codes work once and fail on reuse.
- The 12-hour session re-verification deadline is enforced at both API and page routes.
- MFA enrollment and factor replacement revoke other sessions.
- TOTP secrets never appear in logs or admin user-list APIs.
