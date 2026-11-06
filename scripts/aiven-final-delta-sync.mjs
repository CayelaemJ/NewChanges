#!/usr/bin/env node
// NON-DESTRUCTIVE FINAL DELTA. Does not switch traffic or change Cloudflare.
// --check is read-only. --execute requires frozen Neon and independent approvals.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { auditColumns, buildAivenDeltaSql } from './aiven-final-delta-plan.mjs';

const mode=process.argv[2]||'--check';
if (!['--check','--execute'].includes(mode)) { console.error('Usage: node scripts/aiven-final-delta-sync.mjs [--check|--execute]'); process.exit(2); }
function connection(raw, side) {
  if (!raw) throw Error('Missing '+side+' URL');
  const u=new URL(raw), host=u.hostname.toLowerCase(), db=decodeURIComponent(u.pathname.slice(1));
  if (!['postgres:','postgresql:'].includes(u.protocol)) throw Error('Bad URI');
  if (side==='source' && (!host.endsWith('.neon.tech')||db!=='newchanges')) throw Error('Unexpected source endpoint');
  if (side==='target' && (host!=='the-fixer-postgres-cay-bed7.b.aivencloud.com'||u.port!=='26029'||db!=='defaultdb')) throw Error('Unexpected target endpoint');
  const env={...process.env};
  for(const key of ['PGHOST','PGHOSTADDR','PGPORT','PGUSER','PGPASSWORD','PGDATABASE','PGSSLMODE','PGCHANNELBINDING','PGOPTIONS','PGSERVICE','PGSERVICEFILE']) delete env[key];
  env.PGHOST=host;env.PGPORT=u.port||'5432';env.PGUSER=decodeURIComponent(u.username);
  env.PGPASSWORD=decodeURIComponent(u.password);env.PGDATABASE=db;
  env.PGSSLMODE=u.searchParams.get('sslmode')||'require';env.PGCONNECT_TIMEOUT='15';
  if(u.searchParams.has('channel_binding'))env.PGCHANNELBINDING=u.searchParams.get('channel_binding');
  return env;
}
function psql(env,sql,stage,maxBuffer=16*1024*1024,raw=false){
  const r=spawnSync('psql',['-w','-X','-A','-t','-q','-v','ON_ERROR_STOP=1','-f','-'],{
    env,input:sql,encoding:'utf8',timeout:180000,maxBuffer
  });
  if(r.status!==0||r.error)throw Error('PostgreSQL query failed at '+stage+' (sensitive diagnostics withheld)');
  return raw ? r.stdout : r.stdout.trim();
}
function verify(){
  const r=spawnSync(process.execPath,['scripts/aiven-verify-content.mjs'],{
    env:process.env,encoding:'utf8',timeout:300000,maxBuffer:1024*1024
  });
  if(r.stdout)process.stdout.write(r.stdout);
  if(r.status!==0||r.error)throw Error('Content verification failed');
  return r.stdout;
}
const cols=auditColumns;
const lit=value=>"'"+value.replaceAll("'","''")+"'";
let dir;
try{
  const src=connection(process.env.DR_SOURCE_DATABASE_URL,'source');
  const dst=connection(process.env.DR_TARGET_DATABASE_URL,'target');
  const before=verify();
  if(mode==='--check'){
    console.log('DRY RUN: no writes, no user/session changes, no Cloudflare traffic switch.');
    process.exit(0);
  }
  for(const key of ['AIVEN_SOURCE_WRITERS_FENCED','AIVEN_FINAL_DATA_SYNC_APPROVED','AIVEN_RECOVERY_BACKUP_VERIFIED']){
    if(process.env[key]!=='YES')throw Error('Missing '+key+'=YES approval');
  }
  if(!/CONTENT SUMMARY: identical_application_tables=56\/56; mismatches=0/.test(before)||
     !/AUDIT PREFIX: MATCH/.test(before)||
     !/SESSION ACTIVITY: changed_or_missing=\d+; missing_keys=0/.test(before))
    throw Error('Source/target differ outside approved audit and activity fields');
  process.stdout.write('Final Aiven-only audit/session delta. Type SYNC-AIVEN-DELTA: ');
  const approval=spawnSync('bash',['-c','IFS= read -r answer; printf "%s" "$answer"'],{
    stdio:['inherit','pipe','inherit'],encoding:'utf8',timeout:60000
  });
  if(approval.status!==0||approval.stdout!=='SYNC-AIVEN-DELTA')throw Error('Operator declined');
  const watermark=psql(dst,'BEGIN TRANSACTION READ ONLY;\nSELECT max("createdAt")::text FROM public."DataAccessEvent";\nCOMMIT;\n','audit watermark');
  if(!/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)?$/.test(watermark))throw Error('Invalid audit watermark');
  dir=mkdtempSync(join(tmpdir(),'newchanges-aiven-delta-'));
  const audit=join(dir,'audit.csv'),sessions=join(dir,'sessions.csv');
  const auditSql='COPY (SELECT '+cols+' FROM public."DataAccessEvent" WHERE "createdAt">=TIMESTAMP '+lit(watermark)+
    ' ORDER BY "createdAt",id) TO STDOUT WITH (FORMAT csv, NULL '+lit('\\N')+');\n';
  const sessionSql='COPY (SELECT "id","lastSeenAt" FROM public."Session" ORDER BY "id") TO STDOUT WITH (FORMAT csv, NULL '+lit('\\N')+');\n';
  writeFileSync(audit,psql(src,auditSql,'audit delta export',64*1024*1024,true),{mode:0o600,flag:'wx'});
  writeFileSync(sessions,psql(src,sessionSql,'session activity export',4*1024*1024,true),{mode:0o600,flag:'wx'});
  // All writes are atomic in a single destination transaction.
  const sql=buildAivenDeltaSql(audit,sessions);
  psql(dst,sql,'atomic Aiven delta');
  console.log('AIVEN TRANSACTION COMMITTED. Post-commit verification follows.');
  const after=verify();
  if(!/CONTENT SUMMARY: identical_application_tables=56\/56; mismatches=0/.test(after)||
     !/AUDIT PREFIX: MATCH/.test(after)||
     !/new_source_events=0(?:\D|$)/.test(after)||
     !/SESSION ACTIVITY: changed_or_missing=0; missing_keys=0/.test(after)){
    throw Error('Post-commit verification not complete; KEEP CLOUDFLARE CUTOVER DISABLED');
  }
  console.log('PASS: Aiven data delta matches currently checked Neon source. No application traffic changed.');
}catch(err){
  console.error('BLOCKED:',err.message);
  process.exitCode=2;
}finally{
  if(dir)rmSync(dir,{recursive:true,force:true});
}
