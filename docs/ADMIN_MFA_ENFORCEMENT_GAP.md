# Administrator MFA — staging status

The previously identified absent MFA schema and session guard now have implementations on draft PR #219. The administrator API gate is opt-in via `ADMIN_MFA_ENFORCE=true` and is **disabled by default** to prevent accidental administrator lockout.

The passkey flow comprises browser WebAuthn enrollment/sign-in, fixed trusted origin and RP ID, verifier-backed signed assertion checks, challenge expiration and one-time use, credential-counter checks, session rotation, and short-lived elevated sessions. First-time enrollment requires a one-time security grant. Recovery is implemented for **synthetic local fixtures only**, not production.

Blocking issues before claiming complete or deploying:
- Commit npm-generated, integrity-checked `package.json` plus `package-lock.json` for `@simplewebauthn/server@14.0.3`.
- Execute a successful synthetic signed WebAuthn registration/authentication test (not just negative cases).
- Validate the native browser workflow on actual passkey-capable devices with a disposable staging database.
- Independently authenticate operational approvals and design production recovery, then verify a real account-recovery rehearsal.
- Audit all administrator state-changing routes and rollout redirects, and test the production migration and rollback plan.
- Keep `ADMIN_MFA_ENFORCE` off until an explicitly approved staging cutover and operational recovery exists.

See `docs/ADMIN_MFA_PASSKEY_ROLLOUT.md` for details. Do not reuse cloud/production secrets in CI.
