import test from 'node:test';
import assert from 'node:assert/strict';
import {createNativeAuthRouter} from '../cloudflare/native-auth-router.mjs';
import {roleModules} from '../cloudflare/session-compat.mjs';
const root='https://migration.newchanges-app.pages.dev';
const cookie='session='+('c'.repeat(64));
const row={expiresAt:new Date('2040-01-01'),endedAt:null,revokedAt:null,
 user:{id:'test-person',active:true,deletedAt:null,role:'VIEWER',links:[{employerId:'tenant-a'}]}};
const db={session:{findUnique:async()=>row},$queryRaw:async()=>[{"?column?":1}],$disconnect:async()=>{}};
const req=(p,opts={})=>new Request(root+p,opts);
test('liveness and version genuinely run without SQL or session dependency',async()=>{
 const worker=createNativeAuthRouter({openDatabase:async()=>{throw new Error('unexpected SQL')}});
 assert.equal((await worker.fetch(req('/health'))).status,200);
 const v=await (await worker.fetch(req('/version'))).json();
 assert.equal(v.version,'0.10.0');
 assert.equal(v.cloudflareStage,'migration');
});
test('auth migration refuses missing session and disabled stages before SQL',async()=>{
 let calls=0;
 const worker=createNativeAuthRouter({openDatabase:async()=>{calls++;return db}});
 assert.equal((await worker.fetch(req('/api/migration/auth-check'))).status,401);
 assert.equal((await worker.fetch(req('/api/migration/auth-check',{headers:{Cookie:cookie}}))).status,503);
 assert.equal(calls,0);
});
test('never interprets a present cookie as permission without a Hyperdrive binding',async()=>{
 let calls=0;
 const worker=createNativeAuthRouter({openDatabase:async()=>{calls++;return db}});
 const r=await worker.fetch(req('/api/migration/auth-check',{headers:{Cookie:cookie}}),{MIGRATION_AUTH_CHECK_ENABLED:'true'});
 assert.equal(r.status,503);
 assert.equal(calls,0);
});
test('existing-session authentication returns only non-sensitive role capabilities',async()=>{
 let opened=0,closed=0;
 const driver={...db,$disconnect:async()=>{closed++}};
 const worker=createNativeAuthRouter({openDatabase:async()=>{opened++;return driver}});
 const res=await worker.fetch(req('/api/migration/auth-check',{headers:{Cookie:cookie}}),{HYPERDRIVE:{connectionString:'postgres://synthetic.example/test'},MIGRATION_AUTH_CHECK_ENABLED:'true'});
 assert.equal(res.status,200);
 const json=await res.json();
 assert.deepEqual(json,{authenticated:true,role:'VIEWER',modules:roleModules('VIEWER')});
 assert.equal(JSON.stringify(json).includes('test-person'),false);
 assert.equal(opened,1);assert.equal(closed,1);
 assert.match(res.headers.get('cache-control'),/no-store/);
 assert.equal(res.headers.get('set-cookie'),null);
});
test('database failures never leak secrets and cleanup is attempted',async()=>{
 let closed=0;
 const worker=createNativeAuthRouter({openDatabase:async()=>({$queryRaw:async()=>{throw new Error('postgres://user:password@private')},$disconnect:async()=>{closed++}})});
 const r=await worker.fetch(req('/ready'),{HYPERDRIVE:{connectionString:'synthetic'}});
 assert.equal(r.status,503);
 assert.doesNotMatch(await r.text(),/password|private/);
 assert.equal(closed,1);
});
test('unknown and mutating private operations remain denied',async()=>{
 const worker=createNativeAuthRouter({openDatabase:async()=>db});
 for(const path of ['/api/auth/login','/api/auth/me','/api/dashboard','/admin','/api/admin/users']){
  assert.equal((await worker.fetch(req(path))).status,404,path);
 }
 for(const method of ['POST','PUT','PATCH','DELETE'])
  assert.equal((await worker.fetch(req('/ready',{method}))).status,405,method);
});
