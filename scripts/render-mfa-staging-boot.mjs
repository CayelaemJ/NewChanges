// Synthetic-only MFA preview. Never connect this entrypoint to production.
// Supports an ephemeral loopback Postgres when private Render database credentials
// cannot be accessed via the connector. Its data disappears on container restart.
import {spawnSync,spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {readdirSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const expectedHost='dpg-dbib30142hec73cus92g-a';
const expectedDatabase='newchanges_mfa_synthetic_staging_db';
const expectedOrigin='https://newchanges-mfa-isolated-staging.onrender.com';
const expectedRpId='newchanges-mfa-isolated-staging.onrender.com';
const port=Number(process.env.PORT||3000);
const localMode=process.env.MFA_STAGING_LOCAL_EPHEMERAL_DB==='true';
const localDatabase='newchanges_mfa_ephemeral';
const localPort='55432';

function safeConfig(){
 if(process.env.MFA_STAGING_ONLY!=='true' ||
    process.env.MFA_STAGING_SYNTHETIC_ONLY!=='true' ||
    process.env.STANDBY_MODE!=='true' ||
    process.env.TRAFFIC_SAVER_MODE!=='true' ||
    !['false','true'].includes(process.env.ADMIN_MFA_ENFORCE) ||
    (process.env.ADMIN_MFA_ENFORCE==='true' &&
       process.env.MFA_STAGING_ENFORCEMENT_APPROVED!=='true') ||
    process.env.COOKIE_SECURE!=='true' ||
    process.env.MFA_RP_ID!==expectedRpId ||
    process.env.MFA_EXPECTED_ORIGIN!==expectedOrigin) return false;
 const gate=process.env.MFA_STAGING_GATE_PASSWORD;
 if(!gate || Buffer.byteLength(gate,'utf8')<24 ||
    Buffer.byteLength(gate,'utf8')>256) return false;
 if(localMode){
   // A staging container must not inherit ANY external database connection.
   // The only connection is generated below after starting loopback Postgres.
   return !process.env.DATABASE_URL && process.env.NODE_ENV==='production';
 }
 const raw=process.env.DATABASE_URL;
 if(!raw)return false;
 try{
  const u=new URL(raw),hostname=u.hostname.toLowerCase();
  return ['postgresql:','postgres:'].includes(u.protocol) &&
    decodeURIComponent(u.pathname)==='/'+expectedDatabase &&
    (hostname===expectedHost ||
     (hostname.startsWith(expectedHost+'.') && hostname.endsWith('.render.com')));
 }catch{return false}
}

function locked(message){
 process.stderr.write(message+'\n');
 createServer((req,res)=>{
   const healthy=req.url==='/health';
   res.writeHead(healthy?200:503,{
     'Content-Type':'text/plain; charset=utf-8',
     'Cache-Control':'no-store',
     'X-Robots-Tag':'noindex, nofollow',
     'X-Content-Type-Options':'nosniff'
   });
   res.end(healthy?'MFA staging startup gate active':
     'Synthetic MFA staging is locked; database or access configuration is incomplete.');
 }).listen(port,'0.0.0.0');
}
function run(exe,args,env=process.env,diagnostic=false){
 const result=spawnSync(exe,args,{
   env,encoding:'utf8',timeout:120000,maxBuffer:1024*1024
 });
 if(diagnostic && result.status!==0){
   const name=exe.split('/').at(-1);
   // These PostgreSQL setup commands do not include application credentials.
   // Never log environment variables, DATABASE_URL or user-supplied arguments.
   const details=String(result.stderr||result.error?.message||'No stderr')
     .replace(/postgres(?:ql)?:\/\/[^\s]+/gi,'[REDACTED_DB_URI]')
     .slice(0,700);
   process.stderr.write('Synthetic database '+name+' failed: '+details+'\n');
 }
 return result.status===0;
}
function startDisposablePostgres(){
 let versions;
 try{versions=readdirSync('/usr/lib/postgresql').sort((a,b)=>Number(b)-Number(a))}
 catch{return false}
 const version=versions?.find(v=>/^\d+$/.test(v));
 if(!version)return false;
 const bin='/usr/lib/postgresql/'+version+'/bin/';
 const dataDir=mkdtempSync(join(tmpdir(),'newchanges-mfa-pg-'));
 // PostgreSQL runs as the existing non-root "node" container user.
 // Host-based authentication is trust ONLY on an unexposed loopback port.
 // It is not a durable DB, and its credentials are NEVER used by production.
 if(!run(bin+'initdb',['-D',dataDir,'-U','node','-A','trust','--no-instructions'],process.env,true))
   return false;
 const options='-h 127.0.0.1 -p '+localPort+
   ' -c listen_addresses=127.0.0.1 -c shared_buffers=16MB'+
   ' -c max_connections=20 -c fsync=off -c synchronous_commit=off';
 if(!run(bin+'pg_ctl',['-D',dataDir,'-l',join(dataDir,'server.log'),
   '-o',options,'-w','start'],process.env,true))return false;
 const pgEnv={...process.env,PGHOST:'127.0.0.1',
    PGPORT:localPort,PGUSER:'node',PGPASSWORD:''};
 if(!run(bin+'createdb',['-h','127.0.0.1','-p',localPort,
    '-U','node',localDatabase],pgEnv,true))return false;
 process.env.DATABASE_URL='postgresql://node@127.0.0.1:'+
    localPort+'/'+localDatabase;
 return true;
}

if(!safeConfig()){
 locked('Staging refused: synthetic-only settings or access credential missing.');
}else{
 const databaseReady=!localMode || startDisposablePostgres();
 if(!databaseReady){
   locked('Staging refused: disposable loopback PostgreSQL failed to start.');
 }else{
   // Staging schema setup is allowed only after the exact database guard.
   // No production URLs or destructive reset flags are accepted.
   const migrated=run('node',['node_modules/prisma/build/index.js','db','push']);
   if(!migrated){
     locked('Staging refused: synthetic PostgreSQL schema setup failed.');
   }else{
     const seed=process.env.MFA_STAGING_BOOTSTRAP_FIXTURES==='true';
     const seeded=!seed || run('node',['scripts/mfa-staging-seed.mjs']);
     if(!seeded){
       locked('Staging refused: synthetic administrator fixture setup failed.');
     }else{
       process.stdout.write('Synthetic MFA staging started with restricted access.\n');
       const server=spawn('node',['dist/server.js'],{stdio:'inherit',env:process.env});
       for(const signal of ['SIGTERM','SIGINT'])
         process.on(signal,()=>server.kill(signal));
       server.on('exit',code=>process.exit(code??1));
     }
   }
 }
}
