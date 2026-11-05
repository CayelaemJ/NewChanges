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
bash scripts/aiven-pg18-upgrade.sh --check
# Inspect the returned task ID and confirm it succeeded; check plan/region are unchanged.
# Supply that exact task ID; the script re-queries Aiven and refuses a failed, mismatched or older-than-one-hour task.
AIVEN_PG18_CHECK_TASK_ID=TASK_ID AIVEN_PG18_UPGRADE_APPROVED=YES \
  bash scripts/aiven-pg18-upgrade.sh --upgrade
# The script still requires typing UPGRADE-EXISTING-FREE at its confirmation prompt.
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
`scripts/aiven-stream-snapshot.sh` is a manual, one-shot, compressed archive restore to the existing Aiven destination. By default it exits without connecting to either DB. The execute mode requires source and target secrets in the operator's secure environment, plus eight separate `AIVEN_...=YES` approvals covering:
- authoritative source identity and existing free plan\n- independently verified Aiven host disk headroom including restore WAL
- verified backup and extension review
- cross-border transfer and write freeze
- explicit approval to copy the snapshot

The script refuses a PostgreSQL major-version mismatch, unknown endpoints, nonempty destination, source database larger than 700,000,000 bytes, or normal dependency on the unsupported Neon JWT extension. It never deletes Neon and never rewrites production configuration.

A failed SQL restore uses a single transaction and should roll back database changes, but inspect the destination and capacity after any failure before retrying. Do not assume a connection or infrastructure failure was harmless.

## Gate E: isolated application acceptance testing
- Compare table counts and all source/target row counts.
- Check roles, admin MFA, login/session continuity, tenant restrictions and source-connection configuration.
- Exercise source sync, dashboard cohort reports and historical read models on an isolated test deployment only.
- Verify normal app behavior, performance and Aiven disk/connection limits.
- Schedule a separate, explicitly approved production cutover and rollback decision.

**No database traffic switch, merge, deletion, or data transfer has been authorized by this document.**


## 2026-11-05 verified PG18 preflight and portability correction

- Both Neon source and Aiven destination run PostgreSQL **18.6**.
- Neon database `newchanges`: 428,351,488 bytes (~408.5 MiB), 57 public application tables, 2 public views. Public tables occupy approximately 183 MB heap plus 157 MB indexes; total public relation footprint about 399 MB (PostgreSQL human-readable units).
- Neon also has **9 tables in `neon_auth`**, separate from the 57 public application tables. This is a vendor-managed identity schema and is **not copied** by the new `--schema=public` dump scope. No public function or view text directly referenced `neon_auth` on the checked source. Application code, identities, login flows, and any external authentication integrations still require independent inspection before cutover.
- Aiven destination `defaultdb`: PostgreSQL 18.6, 8,304,319 bytes (~7.9 MiB), 0 user tables, 0 user views; existing free plan, 1 GiB storage.
- Aiven monitoring's latest disk_usage metric was 26.553 in its native units. **Do not assume ~408 MiB source DB can fit safely**: destination disk includes PostgreSQL internals, write-ahead logs, indexes, vacuum, and transient migration overhead. The SQL database size is not the total occupied disk space.
- **AIVEN_DISK_HEADROOM_VERIFIED=YES** now requires explicit operator assessment of headroom and WAL budget before data copying. Setting it blindly is not validation.
- Use `npm run check:aiven-migration` after pulling this branch. For an actual schema-only test, ensure PostgreSQL 18 `pg_dump` and `pg_restore`, the existing local Docker `postgres:18-alpine` image, and a securely supplied read-only source URL are available; run `bash scripts/aiven-pg18-local-schema-test.sh`. The schema archive and restore container are local and disposable.
- Do not execute the full snapshot transfer or production cutover until restored schema, cross-border transfer, authentication dependencies, and free-tier disk pressure are confirmed safe.

## Gate C2: isolated full-data PostgreSQL 18 restore trial

After the 57-table schema trial passes, use the optional full-data trial, **before any Aiven restore**:

```sh
git pull --ff-only
npm run check:aiven-migration
# DR_SOURCE_DATABASE_URL must already be supplied securely in the local shell.
AIVEN_LOCAL_DATA_TRIAL_APPROVED=YES bash scripts/aiven-pg18-local-data-test.sh --execute
```

This reads the Neon `newchanges` source and creates one consistent custom-format `public` schema-and-data snapshot in a permissions-restricted temporary local directory. It then restores that archive into a disposable local Docker PostgreSQL 18 container with `--network none`, no published ports, `--single-transaction` and `--exit-on-error`. It checks all public table counts against the current live source and prints restored database and compressed archive sizes (bytes). Archives, logs and container are removed at exit. The snapshot does not include Neon-managed `neon_auth`; authentication and identity flows must be assessed separately.

Neon application writes can continue during this **diagnostic trial**, but source row counts captured *after* the snapshot can drift; this is reported as a count mismatch and is not proof of lost data. Do not freeze production writes just for a disposable diagnostic trial. A final cutover would need a separately authorized write freeze and snapshot-consistent verification.

The archive contains real application data on the local machine during this test. Ensure local disk space, Docker space, endpoint privacy, and applicable data handling approval before executing. The test creates **no Aiven connection** and does not initiate cutover. A successful local restore measures the application footprint but does not guarantee Aiven has sufficient available disk/WAL headroom.

## 2026-11-05 data trial and managed-schema restore update
- Disposable PostgreSQL 18 full-data restore completed: **57 public tables**, **206,608,063 restored database bytes**, and **17,295,651 compressed archive bytes**.
- Live Neon audit activity caused a four-record count difference in `DataAccessEvent` (61,151 live versus 61,147 at snapshot). 56/57 post-snapshot live counts matched. This does not establish final snapshot parity.
- Aiven `defaultdb` already has an empty `public` schema. The one-shot transfer now saves a private local compressed archive, omits only the redundant `SCHEMA - public` table-of-contents entry and performs an atomic restore with `--use-list` and `--single-transaction`. No remote schema drop is performed. The archive is deleted on exit.
- The Prisma schema defines application `User` and `Session` models and contains no literal `neon_auth` reference. This is not sufficient evidence to skip runtime authentication acceptance testing.
- Live transfer remains **blocked** until free-tier disk/WAL headroom, a verified independent Neon backup, applicable cross-border data transfer approval, extension support and cutover/write coordination have been assessed and explicitly approved. No production DATABASE_URL change is permitted during this trial.

## Gate B2: no-new-cloud-charge local recovery archive

The source Neon project is on a usage-billed Launch subscription. A new Neon snapshot can accrue storage charges, so **do not create a new hosted snapshot automatically** under the zero-additional-cost constraint. The available historical Neon snapshot dates to 2026-10-13 and does not protect current data.

To create a persistent local recovery artifact without adding hosted storage, run:

```sh
git pull --ff-only
npm run check:aiven-migration
# DR_SOURCE_DATABASE_URL must already be configured in your current shell.
DR_LOCAL_BACKUP_APPROVED=YES bash scripts/aiven-local-recovery-backup.sh --execute
```

This dumps **all readable source schemas**, unlike the portable Aiven public-only transfer, to a user-owned local directory with 0700 directory/0600 archive permissions; it verifies readable archive metadata and 57 public table definitions and prints a checksum. It neither uses Aiven nor changes Neon. Archive contents contain sensitive live records and must be stored and protected appropriately. A metadata check and checksum are **not a recovery restore test**; mark recovery as verified only after performing a successful restore to an isolated authorized environment and validating the data. Neon-managed auth and provider-specific extensions can prevent portable restoration; retain Neon and its existing recovery options through the migration.

Extension inspection on 2026-11-05: Neon has plpgsql, pg_stat_statements, and pg_session_jwt installed; the two Neon-specific extensions are excluded from the 57-table portable application copy. Aiven has pg_stat_statements available, but does not expose pg_session_jwt as available. Source application-schema restore already succeeded without those extensions. Cross-border data transfer to India still requires authorization. Aiven's disk metric has been 26.553 in native units; do not set AIVEN_DISK_HEADROOM_VERIFIED=YES on that number alone.

## Verified recovery and point-in-time test-copy mode (2026-11-05)

The local archive `newchanges-recovery-20261105T104649Z.dump` was restored by the operator in network-isolated Docker PostgreSQL 18. Output confirmed `PASS: exact backup restored to isolated PG18; public tables=57` and expected SHA256 `f284e31b37f20416c2d473787857052e193c1edfd865e5d0fc3b923bfffdb77a`. This verifies the portable public schema and data, **not** complete Neon-managed auth recovery.

The user authorized proceeding with an Aiven India test copy while Neon remains the active writable production database. The import script now supports `AIVEN_POINT_IN_TIME_TEST=YES` and `AIVEN_LIVE_SOURCE_DRIFT_ACCEPTED=YES` in place of `AIVEN_WRITES_FROZEN=YES`. In that mode, live row-count differences are warnings and are not proof of corruption. Do not treat source/live counts as snapshot-consistent validation.

Before running `--execute`, the operator must **actually verify** disk/WAL headroom on Aiven's 1GB free plan and determine whether the available local recovery archive satisfies their backup policy; only then should they set `AIVEN_DISK_HEADROOM_VERIFIED=YES` and `AIVEN_BACKUP_VERIFIED=YES`. The current Aiven metrics API reports disk_usage=26.553 without independently established units; this is not by itself an authorization to set the storage flag. Operator must also approve `AIVEN_CROSS_BORDER_APPROVED=YES` for transfer of live user/audit records from Germany to India, and `AIVEN_SNAPSHOT_COPY_APPROVED=YES`. No application cutover is authorized. Restoring to an empty target is an intentional database write, and Aiven target will no longer be empty afterward; do not rerun a completed import.

At the execution point, after reviewing the limits:
```sh
cd ~/NewChanges
git pull --ff-only
npm run check:aiven-migration
# Existing exported source + target environment variables must be present.
AIVEN_SOURCE_CONFIRMED=YES \
AIVEN_FREE_PLAN_VERIFIED=YES \
AIVEN_DISK_HEADROOM_VERIFIED=YES \
AIVEN_BACKUP_VERIFIED=YES \
AIVEN_EXTENSION_REVIEWED=YES \
AIVEN_CROSS_BORDER_APPROVED=YES \
AIVEN_POINT_IN_TIME_TEST=YES \
AIVEN_LIVE_SOURCE_DRIFT_ACCEPTED=YES \
AIVEN_SNAPSHOT_COPY_APPROVED=YES \
bash scripts/aiven-stream-snapshot.sh --execute
```
Do not set approval variables unless their conditions are met. If a write fails because of the 1GiB storage limit, do not upgrade or delete production; preserve Neon and investigate target restore state first.
