# The Fixer — one-time-display MFA recovery key

**Status:** PR #219; staging/testing only until reviewed and approved. Production MFA
and production database configuration remain unchanged.

## Enrollment experience

After successful initial passkey or authenticator enrollment, The Fixer creates
a cryptographically random 32-byte recovery key encoded as 43 base64url
characters. The server stores its SHA-256 hash, never the plaintext. The user
is presented with the key exactly once in a dedicated warning panel and must
acknowledge that they have saved it before the panel is dismissed.

Display guidance:
- Save it in a trusted password manager or on paper secured separately.
- Never send it in email, a screenshot, tickets, or chat.
- Do not leave a copy on the same device used for MFA.
- Do not mistake it for the global ADMIN_MFA_TOTP_ENCRYPTION_KEY or the TOTP QR
  provisioning seed. Those are different secrets.

The user cannot retrieve the plaintext key from PostgreSQL or through any
status endpoint. The browser never places it in localStorage or sessionStorage.
The raw value is returned only in the successful first enrollment response;
subsequent calls return null for already-issued keys.

## Previously enrolled users

A newly added server endpoint can issue a first recovery key only after fresh
MFA verification. It refuses if the account already has a recovery key. Browser
self-service UI for these pre-existing accounts is still pending and must not
issue keys without a deliberate user action.

## Recovery policy

A recovery key alone must **not** bypass password login or the two-person
superadministrator recovery authorization. The existing dual-superadmin recovery
approval endpoint accepts an OPTIONAL saved recovery key as additional
proof. When provided, the key must match its stored hash and is atomically
consumed together with successful recovery. All old backup keys are invalidated
when credentials are reset, whether or not a code was presented. The target's
next successful MFA enrollment can issue a new key.

There is NO self-service recovery-key redemption screen yet. The two-person
administrator recovery remains mandatory; the backend's optional recovery-key
input does not automatically restore access. Do not claim the code alone can
reset MFA credentials, and never ask users to paste recovery keys into chat,
support tickets or ordinary email.

Before enabling recovery key redemption, separately review and test:
single-use consumption; password plus key verification; account/session
binding; rate limiting and replay protection; all old credentials/sessions
revoked before new enrollment; and loss/theft scenarios.

This feature uses an additive Prisma migration and must be tested against the
disposable self-hosted Docker CI PostgreSQL before any isolated staging deploy.
