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

The initial database is empty: it contains no administrator accounts. Provision **synthetic, separately approved test admins** before trying hardware enrollment. Do not copy the real Users or Sessions tables.

## Staged MFA enforcement rehearsal
Enforcement remains off initially to avoid lockout.
After independently creating synthetic test admins, enrolling passkeys, and verifying two-superadmin recovery,
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
