# The Fixer: Aiven free-tier operator runbook

**Status:** Prepared, NOT executed. Do not merge or deploy the migration PR to run a database transfer automatically.

## Fixed, cost-sensitive architecture
- Source candidate: Neon `newchanges-primary-pg18`, database `newchanges`, PostgreSQL 18.
- Destination: existing Aiven `cay-bed7/the-fixer-postgres`, DigitalOcean Bangalore (`do-blr`), plan `free-1-1gb`.
- Keep Render and Cloudflare application hosting. Never switch the production `DATABASE_URL` in this procedure.
- No new Aiven service, no plan upgrade, no storage increase, no scheduled export loop, no automatic retry.

## Gate A: align PostgreSQL major versions
Aiven destination is presently PostgreSQL 17.11 with no application tables. Source is PostgreSQL 18.6.
Aiven lists PostgreSQL 18 as supported; the direct update was rejected until a service upgrade compatibility check is completed.

In Aiven Console, open the existing service:
1. Service settings → Service management → Actions → Upgrade version.
2. Select PostgreSQL 18; inspect its compatibility check results and the displayed plan/region.
3. Only proceed if `free-1-1gb` and `do-blr` remain unchanged. Do **not** choose Upgrade plan or create a second service.
4. Recheck the service state, price, region and PostgreSQL version afterward.
5. If Aiven disallows the major upgrade on Free, **stop**. Never choose a paid plan automatically.

Aiven CLI alternative (run via an authenticated local Aiven CLI; never paste tokens into chat or a repository):

```sh
avn service task-create the-fixer-postgres --project cay-bed7 --operation upgrade_check --target-version 18
# Review status of the returned task ID before upgrade; result expires after one hour.
avn service task-get the-fixer-postgres --project cay-bed7 --task-id TASK_ID
# Only after confirmed success, with price and region unchanged:
avn service update the-fixer-postgres --project cay-bed7 -c pg_version=18
```

Official Aiven guide: https://aiven.io/docs/products/postgresql/howto/upgrade

## Gate B: protect data, security and costs
- Verify that Neon `newchanges` is the app's current authoritative database from a securely inspected deployment setting.
- Rotate the Aiven password already exposed in chat; never commit its replacement or print connection URIs.
- Review POPIA cross-border transfer to India and obtain appropriate approval.
- Confirm a recoverable backup of the source and preserve Neon throughout testing.
- Independently verify Aiven is still on the Free 1 GiB plan, PG18, with zero app tables.
- Stop all writes and source-import schedules before taking a final snapshot. Prevent manual endpoints from writing as well.
- A simple source size read was 427,761,664 bytes (about 408 MiB), 57 tables. Source bytes alone do not predict peak restore WAL usage. Check free capacity during restore and stop if any quota warnings appear.

## Gate C: offline tests
```sh
npm run check:aiven-migration
# Optional local PG17 fallback investigation only; needs PG18 pg_dump/pg_restore
# and a PRE-EXISTING Docker postgres:17-alpine image.
bash scripts/aiven-pg17-local-schema-test.sh
```

`scripts/aiven-pg17-local-schema-test.sh` exports schema only, so it does not replicate user data or consume Aiven capacity. The PG17 trial is independent of the proposed version-matched PG18 migration.

## Gate D: one controlled snapshot, NOT production cutover
`scripts/aiven-stream-snapshot.sh` is a manual, one-shot, compressed stream to the existing isolated Aiven destination. By default it exits without connecting to either DB. The execute mode requires source and target secrets in the operator's secure environment, plus seven separate `AIVEN_...=YES` approvals covering:
- authoritative source identity and existing free plan
- verified backup and extension review
- cross-border transfer and write freeze
- explicit approval to copy the snapshot

The script refuses a PostgreSQL major-version mismatch, unknown endpoints, nonempty destination, source database larger than 700,000,000 bytes, or normal dependency on the unsupported Neon JWT extension. It never deletes Neon and never rewrites production configuration.

A failure may leave a **partial copy** in Aiven. Do not rerun the script until the target is reviewed. Every complete rerun would generate another network transfer.

## Gate E: isolated application acceptance testing
- Compare table counts and all source/target row counts.
- Check roles, admin MFA, login/session continuity, tenant restrictions and source-connection configuration.
- Exercise source sync, dashboard cohort reports and historical read models on an isolated test deployment only.
- Verify normal app behavior, performance and Aiven disk/connection limits.
- Schedule a separate, explicitly approved production cutover and rollback decision.

**No database traffic switch, merge, deletion, or data transfer has been authorized by this document.**
