# The Fixer MFA — isolated Render staging

Status: **provisioned, access-locked, not yet connected to its synthetic database**.
This environment is not production and must never use production data, tokens, accounts or credentials.

## Provisioned resources
- Render workspace: `My Workspace`.
- MFA preview: `newchanges-mfa-isolated-staging` (free Docker web service, Frankfurt).
- Preview URL: `https://newchanges-mfa-isolated-staging.onrender.com`.
- Render service: `srv-dbib5261egvs73e466a0`.
- Repository branch: `chore/manual-self-hosted-docker-ci-20261029`, manual deployment only.
- Isolated Render free PostgreSQL: `newchanges-mfa-synthetic-staging-db`.
- Database ID: `dpg-dbib30142hec73cus92g-a`.
- Expected PostgreSQL database name: `newchanges_mfa_synthetic_staging_db`.
- Free database expiry: **2026-11-29**; no managed backups; disposable synthetic records only.
- Production standby is a distinct service on `main`. Never change its environment or database connection.

## Safety controls
The dedicated `Dockerfile.mfa-staging` launches `scripts/render-mfa-staging-boot.mjs`.
The script refuses to run the application until ALL controls pass:
- `MFA_STAGING_ONLY=true` and `MFA_STAGING_SYNTHETIC_ONLY=true`
- `STANDBY_MODE=true` and `TRAFFIC_SAVER_MODE=true` (background jobs off)
- `NODE_ENV=production`, `COOKIE_SECURE=true`
- `ADMIN_MFA_ENFORCE=false` at initial rollout
- `MFA_RP_ID=newchanges-mfa-isolated-staging.onrender.com`
- `MFA_EXPECTED_ORIGIN=https://newchanges-mfa-isolated-staging.onrender.com`
- `DATABASE_URL` points to the **exact named synthetic database** on the expected Render internal host beginning `dpg-dbib30142hec73cus92g-a`
- `MFA_STAGING_GATE_PASSWORD` is independently generated and 24–256 bytes long

When requirements are missing, the public app responds with an inert 503 waiting page (except liveness). When ready, the script runs Prisma `db push` **only on this synthetic DB**, without destructive reset flags. Normal web requests then require HTTP Basic username `mfa-staging` and the separate gate password, in addition to The Fixer's ordinary login and passkey requirements.

## Two remaining secrets — configure in Render only
Render's current connector does not expose the new database's internal connection string or password, so these values were **not added to the repository, tool logs, or chat**.

1. Open the newly created Render Postgres database in **My Workspace → Connect**, and copy its **Internal Database URL** (not the external URL).
2. Open **newchanges-mfa-isolated-staging → Environment** and set `DATABASE_URL` to that internal connection URL.
3. Generate a **new, unique, random password** of at least 24 characters. Add it to the same staging service as `MFA_STAGING_GATE_PASSWORD`. Never use an existing app password or a production secret.
4. Save/redeploy **only the isolated staging service**, never `newchanges-standby`.
5. Open the preview URL over HTTPS. The browser should request HTTP Basic authentication with username `mfa-staging`. Keep the staging password private and do not send it in chat.
6. Confirm `/health`, `/ready`, schema boot, staging access denial on missing/wrong credentials, and that ordinary application login still requires an account.

## Controlled first-run synthetic superadministrators
The initial isolated database is empty. The optional `scripts/mfa-staging-seed.mjs` can create two clearly synthetic SUPERADMIN users with email addresses `mfa-superadmin-a@example.invalid` and `mfa-superadmin-b@example.invalid`, each with a different password and one-time enrollment grant. **No live user account or dataset is copied.**

To use it, set `MFA_STAGING_BOOTSTRAP_FIXTURES=true` on **only** the staging service, and configure these additional secret Render environment variables:
- `MFA_STAGING_ADMIN_A_PASSWORD` and `MFA_STAGING_ADMIN_B_PASSWORD`: independent, random 24+ character passwords, different from the staging access password
- `MFA_STAGING_ADMIN_A_GRANT` and `MFA_STAGING_ADMIN_B_GRANT`: independent, random 32-byte base64url strings (43 characters each); generate locally using a cryptographically secure generator

The script is allowed to run only behind the synthetic-staging guard with MFA enforcement still off. It refuses a partly populated unrelated database, doesn't reissue grants on restarts, hashes passwords with the application's standard scrypt implementation, and stores only SHA-256 digests of the grants. Secret values are not printed or committed. Initial synthetic grants last 24 hours and each can only be consumed once. Set `MFA_STAGING_BOOTSTRAP_FIXTURES=false` after the first successful setup and remove the bootstrap secrets from Render when no longer required.

Do not conflate these synthetic bootstrap grants with production recovery approvals: this is a fixture mechanism solely for device testing. Two separate testers should each enroll a passkey, and neither should use a real production login.



## Staged MFA enforcement rehearsal
Enforcement remains off initially to avoid lockout.
After provisioning separate synthetic test admins, enrolling passkeys, and verifying two-superadmin recovery,
set `ADMIN_MFA_ENFORCE=true` AND `MFA_STAGING_ENFORCEMENT_APPROVED=true` on this staging service only.
Never set these flags on production without separate approval. A staged test should prove:
- Invalid/no passkey -> 403 `MFA_REQUIRED` for admin operations
- Valid signed passkey -> rotated session + privileged operation permitted
- Expired/replayed challenges, revoked credentials and stale sessions fail closed
- Two distinct passkey-verified superadmins can approve recovery; no self-approval
- Audit events are persisted; passkey private keys and raw one-time grant values never are
- Ordinary (non-admin) users can still perform their approved actions

## Validation and cleanup
- Run the dedicated self-hosted Docker CI with offline disposable Postgres before manual staging deployments.
- The initial Render preview deploy may finish before these latest staging-specific commits; autoDeploy is deliberately **off**. Manually redeploy after CI is green.
- This free preview is public-network reachable **behind the Basic access gate**, not a Render private service. Never put real customer or personal data inside it.
- Because the free DB expires on 2026-11-29, plan to delete the staging resources when the rehearsal is finished. Do not upgrade or incur paid charges without explicit approval.
