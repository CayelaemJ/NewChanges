# MFA cutover: encryption key and origin runbook

This runbook prepares the all-account MFA candidate without changing production data, Render secrets, or Cloudflare routing. Keep PR #238 in draft until each applicable gate has evidence and an authorized reviewer approves cutover.

## 1. Protect the TOTP encryption key

`ADMIN_MFA_TOTP_ENCRYPTION_KEY` must be a random 32-byte key encoded as unpadded base64url (43 characters). It encrypts authenticator seeds at rest. Losing it makes enrolled TOTP factors unverifiable; replacing it without re-encrypting stored ciphertext has the same effect.

- Generate a fresh key with a trusted password manager or approved local cryptographic generator. Never reuse a database, session, recovery, or age-backup key.
- Put the value directly into the approved secrets manager. Do not place it in Git, chat, tickets, screenshots, shell command arguments, or CI output.
- Keep a separately protected escrow copy under the organization's secret-recovery policy, with access limited to designated custodians. Do not store the escrow copy beside the encrypted database backup.
- Before any real-user enrollment, rehearse retrieving the escrow copy into an isolated disposable environment. Confirm the application accepts the format and can decrypt a disposable encrypted TOTP fixture. Record only pass/fail, key version, custodian and date; never record the key or fixture secret.
- If the key is ever suspected exposed, treat it as compromised. Plan a reviewed re-encryption/rotation procedure and backup first; do not simply replace the environment variable.

The repository's startup/config checks require TOTP enabled and the 43-character format for writable production. These checks do not prove that escrow or recovery access works.

## 2. Set and verify the relying-party origin

Choose the final user-facing HTTPS hostname before enrolling users. Configure:

- `MFA_RP_ID`: hostname only, with no scheme, port, path, query or trailing dot.
- `MFA_EXPECTED_ORIGIN`: exact HTTPS origin, with no path or trailing slash.

The configured origin's hostname must equal the RP ID or be a subdomain of it. Use the same public hostname in the browser for login, enrollment and verification. Do not test real enrollments against an ephemeral preview hostname and then change the RP ID.

Verify these values in the intended Render service's protected environment settings. Do not paste secret values into a command, commit, or ticket. The RP ID/origin are not secret, but changing them after passkey enrollment can make existing passkeys unusable; record the approved values and owner.

## 3. Consent and migration review

Before a user enrollment rollout, show a clear notice that explains the required second factor, supported methods, recovery-key handling, and how account recovery works. Confirm the wording, accessibility and support process with the product/security owner.

Apply the additive Prisma migrations only to a disposable database first. Review the generated schema diff and migration ordering; confirm existing users and sessions are not silently deleted or promoted. Run the disposable role and tenant tests and review their output before considering any production migration.

## 4. Staged acceptance order

1. Keep the current production writer, database and traffic routing unchanged.
2. Restore the encryption key from protected escrow into an isolated test service and prove the disposable decrypt check.
3. Verify the chosen RP ID and origin on the intended non-production host.
4. Run enrollment, login, protected-route denial before MFA, successful MFA, recovery-key use and session revocation with disposable accounts for every role.
5. Confirm tenant-isolation negative cases, sanitized audit events, rate limits, backup restoration, and support consent/recovery steps.
6. Record evidence without secrets and obtain explicit cutover authorization before changing Render production variables, writing production migrations, fencing a source database, or routing Cloudflare traffic.

## 5. Evidence template

Record only non-secret metadata:

- Candidate commit:
- Service/environment and hostname:
- RP ID approved by:
- Origin approved by:
- Key version/reference (never the key):
- Escrow restore drill date/result:
- Disposable migration and role-matrix result:
- Consent/recovery UX reviewer:
- Backup/restore evidence location:
- Cutover authorization owner/date:

A passing disposable test or startup check alone is not production cutover approval.
