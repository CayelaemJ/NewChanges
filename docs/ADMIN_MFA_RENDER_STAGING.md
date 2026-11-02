# The Fixer MFA — isolated Render staging

Status: **temporary synthetic staging, not suitable for persistent passkey acceptance**. Render free services may sleep after 15 minutes without inbound traffic and take around one minute to wake. The loopback PostgreSQL database is stored on the service's ephemeral filesystem and is LOST on every spin-down/restart/redeploy, including previously enrolled passkeys. Automated CI is green, but multi-session hardware acceptance requires durable staging storage.
This environment is not production and must never use production data, tokens, accounts or credentials.

## Prepared managed PostgreSQL cutover — NOT YET APPLIED (2026-11-02)

**The free Render database already exists and is available**: `newchanges-mfa-synthetic-staging-db`, Frankfurt, ID `dpg-dbib30142hec73cus92g-a`, expiry 2026-11-29. Its external IP allowlist is empty; do not enable public connections. The remote Render connector can't read its internal connection string, and cannot apply/sync Render Blueprints. It cannot directly query this database because external access is blocked.

A separate, **staging-only** `render.mfa-staging.yaml` Blueprint has been prepared in this branch. It references the **existing** database through `DATABASE_URL.fromDatabase.name: newchanges-mfa-synthetic-staging-db` and `property: connectionString`; no username, password or URL is committed. The file defines no `databases` and does not include the production standby service.

The Blueprint changes the existing staging application's modes **together**:
- `MFA_STAGING_LOCAL_EPHEMERAL_DB=false`
- `MFA_STAGING_MANAGED_DB=true`
- `DATABASE_URL` injected privately by Render via `fromDatabase`
- All synthetic-only/standby flags stay enabled; staging MFA enforcement stays independently approved
- The three synthetic account passwords, enrollment grants and independent Basic access password remain in the **existing staging service environment**, not in source control

**One-time action required in Render (no available connector can perform Blueprint sync):**

1. In Render, prefer **Generate Blueprint from existing services** for the existing staging web service and database, rather than cloning resources. The reviewed, staging-only configuration is already committed as **`render.mfa-staging.yaml`** on branch `chore/manual-self-hosted-docker-ci-20261029`. If using Blueprints → New Blueprint to target that file, verify in its preview that Render is **adopting** the existing service rather than creating a suffixed copy. Do not use the root production `render.yaml`.
2. Set **Auto Sync = No**. Carefully inspect the proposed changes **before** applying them. The update should target only existing web service `srv-dbib5261egvs73e466a0` and existing database `dpg-dbib30142hec73cus92g-a`. **If it proposes creating a second web service, a new DB, changing `newchanges-standby`, a paid plan, or a different region, STOP.** A newly created Blueprint may suffix duplicate names; do not approve a duplicate.
3. Once the diff is confirmed safe and the latest Docker CI passes, apply one controlled sync. If the dashboard only offers a duplicate-resource Blueprint, cancel it; the fallback is to copy the database's **Internal Database URL** directly between the two resource pages inside Render (never into chat or source control), and atomically set `DATABASE_URL`, `MFA_STAGING_LOCAL_EPHEMERAL_DB=false`, and `MFA_STAGING_MANAGED_DB=true` on the isolated staging service only. Render should resolve the internal DB connection itself, without exposing the password.
4. Review the staging service logs for `Synthetic MFA staging started with restricted access.` and Fastify startup, plus `/health` and `/ready` (readiness may require the separate staging Basic gate). Do not regard a `Live` badge alone as proof the DB is reachable.
5. Perform passkey enrollment with the synthetic users, then allow the **free web service** to sleep and wake. Confirm the previously enrolled passkey remains registered **without re-enrollment**. Test both superadmin approvals and third-target recovery.
6. Never enable production enforcement or change its database. The free managed DB persists through web service sleep, **but it expires on 2026-11-29**, so do not use it for permanent customer data.

**Current live staging remains on the older, disposable local PostgreSQL mode until this manual Blueprint review and sync completes.** The dedicated, safety-checked managed-DB startup and fixture seeder are committed but not yet validated on the hosted environment.

## Render free service caveat and one-time wake-up

Official Render free-tier behavior: after 15 minutes idle, a free web service spins down; the next incoming HTTP request can take around a minute to wake it. The container filesystem is not persistent across spin-downs. This staging service's **embedded PostgreSQL is on that filesystem**, so wake-up may recreate all three synthetic users and invalidate previous passkey enrollment.

Do not confuse the platform's cold-start loading screen with an authentication failure. Once warm, HTTP 401 at `/` is the staging HTTP Basic access gate working as intended. The one-time readiness utility does not log in and does not send or retrieve credentials.

From a local Windows PowerShell checkout, run:

```powershell
.\\scripts\\wake-mfa-staging.ps1
```

It makes bounded, unauthenticated requests **only** to `https://newchanges-mfa-isolated-staging.onrender.com/health` and stops when the actual JSON `{"ok":true}` is returned. It does not run a continuous keepalive and cannot defeat Render's free-tier spin-down policy.

**Release blocker:** use a genuine, separate, durable staging PostgreSQL database before claiming that a saved passkey survives sleep/restart. A free Render PostgreSQL database has already been provisioned, but its internal connection URL cannot be read through the available Render connector. No production credentials or datasets should be reused. Do not turn on production MFA from this temporary test deployment.

## Verified runtime evidence (2026-10-30)

- Isolated deployment `dep-dbibdjm7bikc73amlmq0` built the staging Dockerfile and started the application with its local PostgreSQL service.
- Render emitted `Synthetic MFA staging started with restricted access.`, then Fastify reported listening on its web port.
- Unauthenticated `HEAD /` and `GET /` requests returned `401`, demonstrating that the independent staging access gate rejects uncredentialed traffic.
- No production database address, existing user records, or production credentials were used.
- The two synthetic SUPERADMIN credentials, separate recovery-target ADMIN credentials and staging access password are stored only in the new Render staging service environment; retrieve them via authorized Render environment access, not chat.
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
- `MFA_STAGING_GATE_PASSWORD`, three independently generated synthetic account passwords and three independent fixture enrollment grants have been set **directly in the staging service's Render environment**. Their values must never be committed or pasted into public messages.
- `MFA_STAGING_BOOTSTRAP_FIXTURES=true` provisions two fabricated superadmin accounts and a separate synthetic ADMIN recovery target on each new, empty container database.
- `ADMIN_MFA_ENFORCE=false` remains the default and only an explicit staging approval may enable it.
- **This is intentionally non-durable.** An instance replacement, idle spin-down or redeploy may destroy the database, registered passkeys, and user sessions. This environment is for brief interactive device testing only, not a persistent customer-facing service.
- The separately created free Render PostgreSQL resource remains unused and can be reclaimed once a durable staging configuration is agreed. Do not create additional resources without need.
- Run a new Docker CI after each staging-only code change; a successful Render build alone is not a substitute for the full suite.

To inspect the synthetic login credentials, an authorized owner can review the staging service's Render environment directly. There are no shared or production accounts, and the application is protected by its own independent HTTP Basic access gate.

## Controlled first-run synthetic administrator fixtures
The initial isolated database is empty. The optional `scripts/mfa-staging-seed.mjs` provisions two synthetic SUPERADMIN users, `mfa-superadmin-a@example.invalid` and `mfa-superadmin-b@example.invalid`, plus a distinct ADMIN recovery target, `mfa-recovery-target@example.invalid`. Each receives a separate password and one-time enrollment grant. **No live user account or dataset is copied.**

To use it, set `MFA_STAGING_BOOTSTRAP_FIXTURES=true` on **only** the staging service, and configure these additional secret Render environment variables:
- `MFA_STAGING_ADMIN_A_PASSWORD` and `MFA_STAGING_ADMIN_B_PASSWORD`: independent, random 24+ character passwords, different from the staging access password
- `MFA_STAGING_ADMIN_A_GRANT` and `MFA_STAGING_ADMIN_B_GRANT`: independent, random 32-byte base64url strings (43 characters each); generate locally using a cryptographically secure generator
- `MFA_STAGING_TARGET_PASSWORD` and `MFA_STAGING_TARGET_GRANT`: independently generated password and 32-byte base64url grant for the third ADMIN account

The script is allowed to run only with the exact loopback-only ephemeral database URL, behind the synthetic-staging guard, with MFA enforcement off OR explicitly approved in this isolated staging service. It refuses a partly populated unrelated database, doesn't reissue grants on restarts, hashes passwords with the application's standard scrypt implementation, and stores only SHA-256 digests of the grants. Secret values are not printed or committed. Initial synthetic grants last 24 hours and each can only be consumed once. Keep `MFA_STAGING_BOOTSTRAP_FIXTURES=true` only while using the ephemeral mode, because the DB is recreated on container replacement. Remove the bootstrap credentials and delete the disposable deployment when the test is finished.

Do not conflate these synthetic bootstrap grants with production recovery approvals: this is a fixture mechanism solely for device testing. Two separate testers should enroll separate superadministrator passkeys and use the third synthetic ADMIN as the recovery target. Neither tester should use a production login.



## Staged MFA enforcement rehearsal
Enforcement remains off initially to avoid lockout.
A change to Render environment variables restarts the ephemeral container and **destroys all previously enrolled passkeys**. Therefore test enforcement from a fresh synthetic boot: set `ADMIN_MFA_ENFORCE=true` AND `MFA_STAGING_ENFORCEMENT_APPROVED=true` on this staging service only, retaining `MFA_STAGING_BOOTSTRAP_FIXTURES=true` and all three synthetic fixture credentials. Its startup grants permit initial enrollment even while the administrator action gate is enforced. Enroll the two approver passkeys on this new instance and use the third ADMIN for recovery testing. Do not assume prior enrolled passkeys survive a restart.
Never set these flags on production without separate approval. A staged test should prove:
- Invalid/no passkey -> 403 `MFA_REQUIRED` for admin operations
- Valid signed passkey -> rotated session + privileged operation permitted
- Expired/replayed challenges, revoked credentials and stale sessions fail closed
- Two distinct passkey-verified superadmins can approve recovery; no self-approval
- Audit events are persisted; passkey private keys and raw one-time grant values never are
- Ordinary (non-admin) users can still perform their approved actions

## Validation and cleanup
- Run the dedicated self-hosted Docker CI with offline disposable Postgres before manual staging deployments.
- Automatic deployments remain **off**. The latest staging code and new HTTP/WebAuthn integration tests must pass the self-hosted Docker CI before treating them as release-ready. Manually redeploy only the isolated staging service.
- This free preview is public-network reachable **behind the Basic access gate**, not a Render private service. Never put real customer or personal data inside it.
- Because the free DB expires on 2026-11-29, plan to delete the staging resources when the rehearsal is finished. Do not upgrade or incur paid charges without explicit approval.
