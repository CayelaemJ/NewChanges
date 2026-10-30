# The Fixer MFA — isolated Render staging

Status: **staging runtime verified on Render (2026-10-30)** using disposable loopback-only PostgreSQL. Render logs confirm the application booted and unauthenticated requests were rejected with HTTP 401. A physical passkey device test remains outstanding.
This environment is not production and must never use production data, tokens, accounts or credentials.

## Verified runtime evidence (2026-10-30)

- Isolated deployment `dep-dbibdjm7bikc73amlmq0` built the staging Dockerfile and started the application with its local PostgreSQL service.
- Render emitted `Synthetic MFA staging started with restricted access.`, then Fastify reported listening on its web port.
- Unauthenticated `HEAD /` and `GET /` requests returned `401`, demonstrating that the independent staging access gate rejects uncredentialed traffic.
- No production database address, existing user records, or production credentials were used.
- The two synthetic SUPERADMIN credentials and separate access password are stored only in the new Render staging service environment; retrieve them via authorized Render environment access, not chat.
- This is an **automated deployment/bootstrap and authentication-gate check**, not confirmation of passkey registration on a physical authenticator.
- Free Render instances may idle, replacing their ephemeral filesystem and restarting an empty database. Re-enroll passkeys after any such replacement.

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

## Configured without production secrets

Render's current connector cannot reveal the private URL for the separately created Render PostgreSQL service. To avoid copying a production credential or requiring the owner to paste database secrets, **this staging deployment instead runs an ephemeral PostgreSQL instance inside its own Docker container**.

- `MFA_STAGING_LOCAL_EPHEMERAL_DB=true` is enabled only on `newchanges-mfa-isolated-staging`.
- The process accepts **no inherited `DATABASE_URL`** in this mode. It creates `postgresql://node@127.0.0.1:55432/newchanges_mfa_ephemeral` at startup.
- PostgreSQL binds exclusively to loopback; the only published application port is Render's web port.
- `MFA_STAGING_GATE_PASSWORD`, two independently generated synthetic superadmin passwords and two independent fixture enrollment grants have been set **directly in the staging service's Render environment**. Their values must never be committed or pasted into public messages.
- `MFA_STAGING_BOOTSTRAP_FIXTURES=true` provisions two fabricated superadmin accounts on each new, empty container database.
- `ADMIN_MFA_ENFORCE=false` remains the default and only an explicit staging approval may enable it.
- **This is intentionally non-durable.** An instance replacement, idle spin-down or redeploy may destroy the database, registered passkeys, and user sessions. This environment is for brief interactive device testing only, not a persistent customer-facing service.
- The separately created free Render PostgreSQL resource remains unused and can be reclaimed once a durable staging configuration is agreed. Do not create additional resources without need.
- Run a new Docker CI after each staging-only code change; a successful Render build alone is not a substitute for the full suite.

To inspect the synthetic login credentials, an authorized owner can review the staging service's Render environment directly. There are no shared or production accounts, and the application is protected by its own independent HTTP Basic access gate.

## Controlled first-run synthetic superadministrators
The initial isolated database is empty. The optional `scripts/mfa-staging-seed.mjs` can create two clearly synthetic SUPERADMIN users with email addresses `mfa-superadmin-a@example.invalid` and `mfa-superadmin-b@example.invalid`, each with a different password and one-time enrollment grant. **No live user account or dataset is copied.**

To use it, set `MFA_STAGING_BOOTSTRAP_FIXTURES=true` on **only** the staging service, and configure these additional secret Render environment variables:
- `MFA_STAGING_ADMIN_A_PASSWORD` and `MFA_STAGING_ADMIN_B_PASSWORD`: independent, random 24+ character passwords, different from the staging access password
- `MFA_STAGING_ADMIN_A_GRANT` and `MFA_STAGING_ADMIN_B_GRANT`: independent, random 32-byte base64url strings (43 characters each); generate locally using a cryptographically secure generator

The script is allowed to run only with the exact loopback-only ephemeral database URL, behind the synthetic-staging guard with MFA enforcement still off. It refuses a partly populated unrelated database, doesn't reissue grants on restarts, hashes passwords with the application's standard scrypt implementation, and stores only SHA-256 digests of the grants. Secret values are not printed or committed. Initial synthetic grants last 24 hours and each can only be consumed once. Keep `MFA_STAGING_BOOTSTRAP_FIXTURES=true` only while using the ephemeral mode, because the DB is recreated on container replacement. Remove the bootstrap credentials and delete the disposable deployment when the test is finished.

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
