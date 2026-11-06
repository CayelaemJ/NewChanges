#!/usr/bin/env node
// READ ONLY: Compare public schema authorization-related objects between Neon
// and Aiven before an application cutover. Never prints secrets or SQL definitions.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

function config(raw, side) {
  if (!raw) throw Error('Missing '+side+' private database URL');
  const u=new URL(raw);
  const db=decodeURIComponent(u.pathname.slice(1)), host=u.hostname.toLowerCase();
  if(!['postgres:','postgresql:'].includes(u.protocol) || !u.username || !u.password)
    throw Error('Invalid '+side+' PostgreSQL URL');
  if(side==='source' && (!host.endsWith('.neon.tech') || db!=='newchanges'))
    throw Error('Unexpected Neon source endpoint');
  if(side==='target' && (host!=='the-fixer-postgres-cay-bed7.b.aivencloud.com' ||
      u.port!=='26029' || db!=='defaultdb'))
    throw Error('Unexpected Aiven target endpoint');
  const tls=u.searchParams.get('sslmode')||'require';
  if(!['require','verify-ca','verify-full'].includes(tls))
    throw Error('Insecure PostgreSQL TLS setting');
  const env={...process.env};
  for(const key of ['PGHOST','PGHOSTADDR','PGPORT','PGUSER','PGPASSWORD','PGDATABASE',
    'PGOPTIONS','PGSERVICE','PGSERVICEFILE','PGSSLMODE','PGCHANNELBINDING']) delete env[key];
  Object.assign(env,{PGHOST:host,PGPORT:u.port||'5432',
    PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),
    PGDATABASE:db,PGSSLMODE:tls,PGCONNECT_TIMEOUT:'15',
    PGOPTIONS:'-c default_transaction_read_only=on'});
  return env;
}
const sql=`
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='30s';
WITH inventory AS (
  SELECT 'table' AS category, c.relname AS object,
    concat_ws('|',c.relrowsecurity,c.relforcerowsecurity,c.relkind) AS detail
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relkind IN ('r','p')
  UNION ALL
  SELECT 'policy',format('%I.%I',schemaname,tablename)||':'||policyname,
    concat_ws('|',permissive,roles::text,cmd,qual,with_check)
  FROM pg_policies WHERE schemaname='public'
  UNION ALL
  SELECT 'trigger',c.relname||':'||t.tgname,
    pg_get_triggerdef(t.oid,true)
  FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND NOT t.tgisinternal
  UNION ALL
  SELECT 'function',p.oid::regprocedure::text,
    pg_get_functiondef(p.oid)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.prokind IN ('f','p')
)
SELECT coalesce(json_agg(json_build_object('category',category,'object',object,
  'detail',detail) ORDER BY category,object),'[]'::json)::text FROM inventory;
COMMIT;`;
function inventory(env, label) {
  const r=spawnSync('psql',['-X','-q','-w','-A','-t','-v','ON_ERROR_STOP=1','-f','-'],{
    env,input:sql,encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024});
  if(r.error || r.status!==0)
    throw Error('Read-only '+label+' schema metadata query failed; private diagnostics withheld');
  const jsonLine=r.stdout.trim().split('\n').find(x=>x.startsWith('['));
  if(!jsonLine) throw Error('No '+label+' schema inventory returned');
  const rows=JSON.parse(jsonLine);
  if(!Array.isArray(rows)) throw Error('Invalid schema inventory');
  const records=new Map();
  for(const row of rows) {
    const key=String(row.category)+':'+String(row.object);
    if(records.has(key)) throw Error('Duplicate inventory key');
    const digest=createHash('sha256').update(String(row.detail??'')).digest('hex');
    records.set(key,{category:row.category,hash:digest});
  }
  return records;
}
try {
  const src=inventory(config(process.env.DR_SOURCE_DATABASE_URL,'source'),'Neon');
  const dst=inventory(config(process.env.DR_TARGET_DATABASE_URL,'target'),'Aiven');
  const counts=map=>{
    const result={table:0,policy:0,trigger:0,function:0};
    for(const row of map.values()) if(row.category in result) result[row.category]++;
    return result;
  };
  const a=counts(src),b=counts(dst);
  console.log('SECURITY PARITY COUNTS (Neon/Aiven): tables='+a.table+'/'+b.table+
    ', policies='+a.policy+'/'+b.policy+', user_triggers='+a.trigger+'/'+b.trigger+
    ', public_functions='+a.function+'/'+b.function);
  let mismatch=0, missing=0, extra=0;
  for(const [key,row] of src) {
    const candidate=dst.get(key);
    if(!candidate) missing++;
    else if(candidate.hash!==row.hash) mismatch++;
  }
  for(const key of dst.keys()) if(!src.has(key)) extra++;
  console.log('SECURITY PARITY SUMMARY: missing_on_target='+missing+
    '; different_definitions='+mismatch+'; extra_on_target='+extra);
  if(a.table!==57 || b.table!==57 || missing || mismatch || extra)
    throw Error('Security schema parity not confirmed. Review differences privately before cutover.');
  console.log('PASS: public-schema table flags, policies, triggers and functions match by definitions.');
  console.log('SCOPE: metadata only; application login/MFA and tenant-isolation tests remain mandatory.');
} catch(err) {
  console.error('BLOCKED:',err instanceof Error?err.message:'Schema parity preflight error');
  process.exitCode=2;
}
