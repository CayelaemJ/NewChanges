import test from 'node:test';
import assert from 'node:assert/strict';
import canary from '../cloudflare/newchanges-isolated-api.worker.mjs';
const origin='https://migration.newchanges-app.pages.dev';
test('isolated health distinguishes Cloudflare from production',async()=>{
 const r=await canary.fetch(new Request(origin+'/api/health'));
 assert.equal(r.status,200);
 assert.deepEqual(await r.json(),{status:'ok',environment:'cloudflare-isolated-canary',production:false});
 assert.equal(r.headers.get('set-cookie'),null);
 assert.equal(r.headers.get('cache-control'),'no-store');
});
test('migration capabilities fail closed for personal data and backend access',async()=>{
 const r=await canary.fetch(new Request(origin+'/api/migration/capabilities'));
 const data=await r.json();
 for(const k of ['auth','dashboard','imports','schedulers','notifications'])assert.equal(data[k],'disabled');
 assert.equal(data.database,'disconnected');
 assert.equal(data.production_render,'unchanged');
});
test('never forwards cookies, credentials, mutations or private API routes',async()=>{
 const old=globalThis.fetch;
 globalThis.fetch=()=>{throw new Error('Canary must never fetch Render, DB, or providers')};
 try{
 for(const p of ['/api/auth/login','/api/auth/me','/api/admin/users','/api/dashboard','/api/source/sync','/api/portfolio','/api/internal/health']){
  const r=await canary.fetch(new Request(origin+p,{headers:{Cookie:'session=blocked',Authorization:'Bearer blocked'}}));
  assert.equal(r.status,404,p);
  assert.equal(r.headers.get('set-cookie'),null);
 }
 for(const method of ['POST','PUT','PATCH','DELETE']){
  const r=await canary.fetch(new Request(origin+'/api/health',{method}));
  assert.equal(r.status,405,method);
 }
 }finally{globalThis.fetch=old}
});
test('HEAD returns only metadata',async()=>{
 const r=await canary.fetch(new Request(origin+'/api/health',{method:'HEAD'}));
 assert.equal(r.status,200);
 assert.equal(await r.text(),'');
});
