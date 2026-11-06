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
// Only these three known Neon pg_stat_statements monitoring functions may be
// absent on Aiven. Ownership must be verified against pg_depend/pg_extension.
const OPTIONAL_NEON_MONITORING_SIGNATURES = new Set([
  'extension_function:pg_stat_statements(boolean)',
  'extension_function:pg_stat_statements_info()',
  'extension_function:pg_stat_statements_reset(oid,oid,bigint,boolean)'
]);
function optionalMonitoringDifference(key,row) {
  return OPTIONAL_NEON_MONITORING_SIGNATURES.has(key) &&
    row?.category==='extension_function' &&
    row?.detail?.startsWith('pg_stat_statements|');
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
  SELECT CASE WHEN ext.extname IS NULL THEN 'function'
         ELSE 'extension_function' END,
    p.oid::regprocedure::text,
    concat_ws('|',coalesce(ext.extname,'application'),
      pg_get_functiondef(p.oid))
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  LEFT JOIN pg_depend dep ON dep.classid='pg_proc'::regclass
    AND dep.objid=p.oid AND dep.deptype='e'
    AND dep.refclassid='pg_extension'::regclass
  LEFT JOIN pg_extension ext ON ext.oid=dep.refobjid
  WHERE n.nspname='public' AND p.prokind IN ('f','p')
  UNION ALL
  -- Explicit normal dependencies from application-defined public functions
  -- onto functions owned by extensions. Exemptions must not hide dependencies.
  SELECT 'extension_dependency', p.oid::regprocedure::text || ' -> ' ||
    referenced.oid::regprocedure::text, extension.extname
  FROM pg_depend d
  JOIN pg_proc p ON d.classid='pg_proc'::regclass AND d.objid=p.oid
  JOIN pg_namespace pn ON pn.oid=p.pronamespace AND pn.nspname='public'
  JOIN pg_proc referenced ON d.refclassid='pg_proc'::regclass AND d.refobjid=referenced.oid
  JOIN pg_depend member ON member.classid='pg_proc'::regclass
    AND member.objid=referenced.oid AND member.deptype='e'
    AND member.refclassid='pg_extension'::regclass
  JOIN pg_extension extension ON extension.oid=member.refobjid
  WHERE d.deptype='n'
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
    records.set(key,{category:row.category,hash:digest,
      // The extension name is not sensitive and is used ONLY to check
      // exact known pg_stat_statements membership, never copied to output.
      detail:row.category==='extension_function'?String(row.detail??''):null});
  }
  return records;
}
try {
  const src=inventory(config(process.env.DR_SOURCE_DATABASE_URL,'source'),'Neon');
  const dst=inventory(config(process.env.DR_TARGET_DATABASE_URL,'target'),'Aiven');
  const counts=map=>{
    const result={table:0,policy:0,trigger:0,function:0,extension_function:0,extension_dependency:0};
    for(const row of map.values()) if(row.category in result) result[row.category]++;
    return result;
  };
  const a=counts(src),b=counts(dst);
  console.log('SECURITY PARITY COUNTS (Neon/Aiven): tables='+a.table+'/'+b.table+
    ', policies='+a.policy+'/'+b.policy+', user_triggers='+a.trigger+'/'+b.trigger+
    ', public_functions='+a.function+'/'+b.function+
    ', extension_functions='+a.extension_function+'/'+b.extension_function);
  let mismatch=0, missing=0, extra=0, optionalMonitoring=0;
  for(const [key,row] of src) {
    const candidate=dst.get(key);
    if(!candidate) {
      if(optionalMonitoringDifference(key,row)) optionalMonitoring++;
      else missing++;
    }
    else if(candidate.hash!==row.hash) mismatch++;
  }
  for(const key of dst.keys()) if(!src.has(key)) extra++;
  // Function signatures are schema metadata, unlike function bodies or rows.
  // Display their identifiers so a missing application routine cannot be
  // mistaken for a Neon-managed extension. Never auto-exempt extension code.
  const absentFunctions=[...src.keys()].filter(key=>
    (key.startsWith('function:')||key.startsWith('extension_function:'))&&!dst.has(key));
  if(absentFunctions.length) console.log('MISSING FUNCTION SIGNATURES (metadata only): '+
    JSON.stringify(absentFunctions.slice(0,20)));
  console.log('SECURITY PARITY SUMMARY: missing_on_target='+missing+
    '; different_definitions='+mismatch+'; extra_on_target='+extra+
    '; accepted_neon_monitoring_only='+optionalMonitoring);
  if(a.table!==57 || b.table!==57 || missing || mismatch || extra ||
     a.extension_dependency || b.extension_dependency)
    throw Error('Security schema parity not confirmed. Review differences privately before cutover.');
  console.log('PASS: application security schema parity; only known Neon pg_stat_statements extension monitoring functions may differ.');
  console.log('SCOPE: metadata only; application login/MFA and tenant-isolation tests remain mandatory.');
} catch(err) {
  console.error('BLOCKED:',err instanceof Error?err.message:'Schema parity preflight error');
  process.exitCode=2;
}
