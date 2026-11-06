import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const backup = new URL('../scripts/production-encrypted-backup.mjs',import.meta.url).pathname;
const invoke=(args,env={})=>spawnSync(process.execPath,[backup,...args],{
  encoding:'utf8',env:{...process.env,...env}
});
test('no production credentials or output directory fail closed',()=>{
 const r=invoke(['source','--preflight'],{DR_SOURCE_DATABASE_URL:''});
 assert.equal(r.status,2);
 assert.match(r.stderr,/Missing source DB URL/);
});
test('cannot redirect the Neon backup to an unrelated database',()=>{
 const r=invoke(['source','--preflight'],{
  DR_SOURCE_DATABASE_URL:'postgresql://fake:fake@attacker.invalid:5432/newchanges'
 });
 assert.equal(r.status,2);
 assert.match(r.stderr,/Unexpected Neon endpoint/);
});
test('cannot back up the wrong Aiven database',()=>{
 const r=invoke(['target','--preflight'],{
  DR_TARGET_DATABASE_URL:'postgresql://fake:fake@the-fixer-postgres-cay-bed7.b.aivencloud.com:26029/other'
 });
 assert.equal(r.status,2);
 assert.match(r.stderr,/Unexpected Aiven endpoint/);
});
test('backup implementation streams through age without writing a raw dump file',()=>{
 const src=readFileSync(backup,'utf8');
 assert.match(src,/spawn\('pg_dump'/);
 assert.match(src,/spawn\('age'/);
 assert.match(src,/dump\.stdout\.pipe\(encrypt\.stdin\)/);
 assert.match(src,/encrypt\.stdout\.pipe\(destination\)/);
 assert.doesNotMatch(src,/--file[=,]/);
 assert.match(src,/rmSync\(tmp,\{force:true\}\)/);
});

test('offline restore drill cannot connect to external databases or networks',()=>{
 const script=readFileSync(new URL('../scripts/verify-encrypted-backup-restore.sh',import.meta.url),'utf8');
 assert.match(script,/--network none/);
 assert.match(script,/postgres:18-alpine/);
 assert.match(script,/pg_restore --exit-on-error/);
 assert.match(script,/set -Eeuo pipefail/);
 assert.match(script,/trap cleanup EXIT/);
 assert.match(script,/table_count.*57|table_count.*!= 57/);
});

test('recovery orchestrator fails closed with no private credentials or key',()=>{
 const script=new URL('../scripts/production-recovery-drill.sh',import.meta.url).pathname;
 const r=spawnSync('bash',[script],{encoding:'utf8',env:{PATH:process.env.PATH||''}});
 assert.equal(r.status,2);
 assert.match(r.stderr,/BLOCKED/);
});
test('recovery orchestrator keeps both DB operations read-only and performs two actual restore drills',()=>{
 const script=readFileSync(new URL('../scripts/production-recovery-drill.sh',import.meta.url),'utf8');
 assert.match(script,/for side in source target/);
 assert.match(script,/production-encrypted-backup\.mjs source --portable-backup/);
 assert.match(script,/production-encrypted-backup\.mjs target --backup/);
 assert.match(script,/verify-encrypted-backup-restore\.sh "\$archive"/);
 assert.match(script,/sha256sum "\$archive"/);
 assert.doesNotMatch(script,/aiven-final-delta-sync|db:push|pg_restore.*onrender/);
});

test('TLS downgrade is rejected before invoking backup tools',()=>{
 const url='postgresql://fake:fake@the-fixer-postgres-cay-bed7.b.aivencloud.com:26029/defaultdb?sslmode=prefer';
 const r=invoke(['target','--preflight'],{DR_TARGET_DATABASE_URL:url});
 assert.equal(r.status,2);
 assert.match(r.stderr,/TLS mode must be/);
});
test('individual backup command independently blocks repository destinations',()=>{
 const src=readFileSync(backup,'utf8');
 assert.match(src,/realpathSync\(folder\)/);
 assert.match(src,/relative\(repository,backupDirectory\)/);
 assert.match(src,/Backup output must be outside the repository checkout/);
});

test('portable mode is deliberately source-only and excludes Neon JWT extension',()=>{
 const src=readFileSync(backup,'utf8');
 assert.match(src,/--portable-backup/);
 assert.match(src,/--schema=public/);
 assert.match(src,/--exclude-extension=pg_session_jwt/);
 assert.match(src,/PORTABLE_PUBLIC_APPLICATION_ONLY/);
 const r=invoke(['target','--portable-backup'],{DR_TARGET_DATABASE_URL:''});
 assert.equal(r.status,2);
});

test('disposable PG18 restore avoids duplicate public schema without touching any live database',()=>{
 const script=readFileSync(new URL('../scripts/verify-encrypted-backup-restore.sh',import.meta.url),'utf8');
 assert.match(script,/--network none/);
 assert.match(script,/docker exec "\$CONTAINER" psql -X -v ON_ERROR_STOP=1 -U postgres -d restorecheck/);
 assert.match(script,/DROP SCHEMA public RESTRICT/);
 assert.ok(script.indexOf('DROP SCHEMA public RESTRICT')<script.indexOf('pg_restore --exit-on-error'));
 assert.doesNotMatch(script,/DROP SCHEMA public CASCADE|psql.*DATABASE_URL/);
});

test('restore selects schema handling by archive catalog (Neon creates public, Aiven may not)',()=>{
 const script=readFileSync(new URL('../scripts/verify-encrypted-backup-restore.sh',import.meta.url),'utf8');
 assert.match(script,/pg_restore --list/);
 assert.match(script,/SCHEMA - public/);
 assert.match(script,/if grep -Eq .*<<< "\\$archive_catalog"/);
 assert.match(script,/DROP SCHEMA public RESTRICT/);
 assert.match(script,/keeping default empty schema/);
 assert.ok(script.indexOf('pg_restore --list') < script.indexOf('DROP SCHEMA public RESTRICT'));
});

test('archive catalog inspection cannot SIGPIPE with pipefail when grep matches early',()=>{
 const script=readFileSync(new URL('../scripts/verify-encrypted-backup-restore.sh',import.meta.url),'utf8');
 assert.match(script,/grep -Eq .*<<< "\$archive_catalog"/);
 assert.doesNotMatch(script,/printf .*\$archive_catalog.*\| grep -Eq/);
});

test('catalog probe drains the authenticated age stream after pg_restore --list',()=>{
 const script=readFileSync(new URL('../scripts/verify-encrypted-backup-restore.sh',import.meta.url),'utf8');
 assert.match(script,/archive_catalog="\$\(age -d -i "\$AGE_IDENTITY_FILE" "\$1" \| \{/);
 assert.match(script,/pg_restore --list\n  cat > \/dev\/null\n\}\)"/);
 assert.doesNotMatch(script,/set \+o pipefail/);
});
test('early catalog reader with remaining pipe drained exits zero under pipefail',()=>{
 const r=spawnSync('bash',['-c',[
  'set -Eeuo pipefail',
  "catalog=\"$(node -e 'process.stdout.write(\"X\".repeat(2000000))' | { head -c 120; cat > /dev/null; })\"",
  'test "${#catalog}" -eq 120'
 ].join('; ')],{encoding:'utf8',timeout:10000});
 assert.equal(r.status,0,r.stderr);
});

test('local PG18 restore uses a bounded 2GiB cap and reports container shutdown evidence before cleanup',()=>{
 const script=readFileSync(new URL('../scripts/verify-encrypted-backup-restore.sh',import.meta.url),'utf8');
 assert.match(script,/--memory 2g --shm-size 256m/);
 assert.doesNotMatch(script,/--memory 768m/);
 assert.match(script,/trap diagnostics ERR/);
 assert.match(script,/trap cleanup EXIT/);
 assert.match(script,/\.State\.OOMKilled/);
 assert.match(script,/docker logs --tail 30/);
 assert.match(script,/RESTORE_STAGE="pg_restore data\/index reconstruction"/);
 assert.doesNotMatch(script,/docker run -d --rm/);
});

test('offline restore container name expands to a valid Docker identifier',()=>{
 const script=readFileSync(new URL('../scripts/verify-encrypted-backup-restore.sh',import.meta.url),'utf8');
 const declaration=script.split('\n').find(line=>line.startsWith('CONTAINER='));
 assert.equal(declaration,'CONTAINER="fixer-backup-restore-${BASHPID}"');
 const probe=spawnSync('bash',['-c',declaration+'; printf "%s" "$CONTAINER"'],{encoding:'utf8'});
 assert.equal(probe.status,0,probe.stderr);
 assert.match(probe.stdout,/^fixer-backup-restore-[0-9]+$/);
});
