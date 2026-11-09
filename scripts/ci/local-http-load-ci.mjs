// Bounded localhost-only HTTP load and authentication-denial checks.
// This is a reliability regression test, not a production capacity benchmark.
import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
const fixture='postgresql://ci_fixture:ci_fixture@127.0.0.1:5432/newchanges_ci';
assert.equal(process.env.CI,'true');
assert.equal(process.env.CI_RLS_PROBE_APPROVED,'CI_DISPOSABLE_ONLY');
assert.equal(process.env.DATABASE_URL,fixture);
process.env.COOKIE_SECURE='false';
process.env.STANDBY_MODE='true';
process.env.TRAFFIC_SAVER_MODE='true';
process.env.ADMIN_MFA_ENFORCE='false';
const {app}=await import('../../dist/server.js');
const {prisma}=await import('../../dist/services/database.js');
const origin='http://127.0.0.1:39745';
const count=180,workers=12;
const latencies=[],errors=[];
let index=0;
const task=async()=>{
 while(index<count){
  index++;
  const start=performance.now();
  try{
   const signal=AbortSignal.timeout(5000);
   // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request -- fixed loopback-only disposable CI fixture; no external traffic.
   const res=await fetch(origin+'/health',{signal,headers:{'Accept':'application/json'}});
   latencies.push(performance.now()-start);
   if(res.status!==200)errors.push('Unexpected health status: '+res.status);
   await res.arrayBuffer();
  }catch(e){errors.push(String(e));}
 }
};
try{
 await app.listen({host:'127.0.0.1',port:39745});
 const before=process.memoryUsage().heapUsed;
 await Promise.all(Array.from({length:workers},task));
 const after=process.memoryUsage().heapUsed;
 const sorted=[...latencies].sort((a,b)=>a-b);
 const p95=sorted[Math.max(0,Math.ceil(sorted.length*.95)-1)]??Infinity;
 assert.equal(latencies.length,count,'All local health requests must complete');
 assert.deepEqual(errors,[],'No 5xx errors, timeouts or dropped health responses');
 assert.ok(p95<3000,'Local health p95 latency exceeded 3000ms: '+p95.toFixed(1));
 assert.ok(after-before<128*1024*1024,'Excessive heap growth for bounded health load');
 // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request -- fixed loopback-only disposable CI fixture; no external traffic.
 const unauth=await fetch(origin+'/api/admin/reports',{signal:AbortSignal.timeout(5000)});
 assert.ok([401,403].includes(unauth.status),'Unauthenticated reports must be denied');
 console.log('[http-load] PASS',JSON.stringify({requests:count,concurrent:workers,p95Ms:Math.round(p95),heapDeltaMiB:Math.round((after-before)/1048576)}));
}finally{await app.close().catch(()=>{});await prisma.$disconnect();}
