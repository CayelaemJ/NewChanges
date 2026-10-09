# MFA and CSP hardening plan

Two security controls remain open. Both are code changes that require a
database and browser to verify, so they are specified here rather than applied
blind. Each is scoped so it can be delivered and tested independently.

## 1. Admin MFA (TOTP)

Goal: enforce a second factor for every `ADMIN` and `SUPERADMIN` account, with
tested enrollment, recovery and session revocation.

### Schema (`prisma/schema.prisma`)

Add to `User`:

```prisma
mfaSecret       String?   // TOTP secret, encrypted at rest
mfaEnabled      Boolean   @default(false)
mfaRecoveryCodes String?  // JSON array of SHA-256 hashed one-time codes
mfaEnrolledAt   DateTime?
```

Ship as a new migration (`prisma migrate dev --name add_admin_mfa`).

### Service (`src/services/mfaService.ts`, crypto-only — no new dependency)

- `generateSecret()` — 20 random bytes, base32-encoded.
- `totp(secret, timeStep)` — HMAC-SHA1 over the counter, RFC 6238, 6 digits,
  30-second step; accept ±1 step for clock skew.
- `verifyTotp(secret, code)` — constant-time comparison.
- `generateRecoveryCodes()` / `verifyRecoveryCode()` — one-time codes stored as
  SHA-256 digests.
- Unit tests must use the RFC 6238 test vectors.

### Flow (`src/server.ts`, `src/services/authService.ts`)

1. On successful password verification for an admin with `mfaEnabled`, do not
   create the session. Return `{ mfaRequired: true, challengeToken }` where the
   challenge is a short-lived, single-use token bound to the user.
2. `POST /api/auth/mfa/verify` accepts `{ challengeToken, code }`, validates the
   TOTP or a recovery code, then creates the session.
3. Enrollment: `POST /api/admin/mfa/enroll` (returns secret + otpauth URL),
   `POST /api/admin/mfa/activate` (confirm a code), `POST /api/admin/mfa/disable`
   (requires password + code).
4. Changing or disabling a factor revokes all existing sessions for that user.
5. Provide a documented break-glass procedure (e.g. a time-boxed,
   `SUPERADMIN`-approved reset) since admins can be locked out.

### UI (`public/users.html`, `public/login.html`)

Add the verification step to the login screen and an MFA panel to the user
administration page.

### Verification

- RFC 6238 vector tests pass.
- Enroll → verify → login succeeds; wrong code is rejected and rate-limited.
- Recovery code works once and is then invalid.
- Disabling MFA revokes sessions.
- Lockout/recovery path is tested.

## 2. Strict Content-Security-Policy

Current CSP allows `script-src 'self' 'unsafe-inline'` because the public pages
use inline `<script>` blocks and inline `on*` event handlers (currently ~88
handlers across `admin.html`, `dashboard.html`, `login.html`,
`set-password.html` and others). `'unsafe-inline'` is ignored as soon as a
nonce is present, so the handlers must be moved out of the HTML first.

### Migration steps

1. Move each inline `<script>` block into an external file under `public/` and
   load it with `<script src="..." defer>`.
2. Replace every inline `on*` attribute with an `addEventListener` binding in
   the corresponding external file. Use `data-*` attributes to carry any
   parameters the handler needs.
3. Emit a per-response nonce and set
   `script-src 'self' 'nonce-<value>'` (keep `'strict-dynamic'` only if a
   bundler requires it). Remove `'unsafe-inline'`.
4. Tighten `style-src` the same way; if inline styles remain unavoidable, use
   hashes rather than `'unsafe-inline'`.
5. Add a regression check that fails if `'unsafe-inline'` reappears in
   `script-src`, and a browser test across desktop/tablet/phone that exercises
   the admin, dashboard and login flows.

### Risk

This is a broad change to the canonical UI and must be verified in a real
browser (the static regression checks cannot prove handlers still fire). Land it
behind the existing UI regression gate plus a manual smoke test, page by page.
