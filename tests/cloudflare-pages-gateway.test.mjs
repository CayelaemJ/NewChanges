import test from 'node:test';
import assert from 'node:assert/strict';
import {createNewChangesPagesGateway} from '../cloudflare/full-app/pages-gateway.mjs';
const make=(p,opts={})=>new Request('https://newchanges-app.pages.dev'+p,opts);
const enable={NEWCHANGES_GATEWAY_ENABLED:'true',NEWCHANGES_GATEWAY_PRODUCTION_APPROVED:'true',NEWCHANGES_FULL_APP_SERVICE:{fetch:async()=>new Response('ok')}};
test('Pages never exposes original backend by default',async()=>{
 const router=createNewChangesPagesGateway();
 for(const env of [{},{NEWCHANGES_GATEWAY_ENABLED:'true'},{...enable,NEWCHANGES_GATEWAY_PRODUCTION_APPROVED:'false'},{...enable,NEWCHANGES_FULL_APP_SERVICE:null}]){
  assert.equal((await router.fetch(make('/api/auth/me'),env)).status,503);
 }
 assert.equal((await router.fetch(new Request('https://migration.newchanges-app.pages.dev/api/auth/me'),enable)).status,503);
});
test('explicit production gateway forwards any method to service binding, not Render',async()=>{
 let calls=0,method='',host='',badHeader='';
 const env={...enable,NEWCHANGES_FULL_APP_SERVICE:{fetch:async request=>{
  calls++;method=request.method;host=new URL(request.url).hostname;
  badHeader=request.headers.get('x-forwarded-host');
  return new Response('original-app-api',{status:202});
 }}};
 const r=await createNewChangesPagesGateway().fetch(make('/api/admin/integration/sync-now',{method:'POST',headers:{'x-forwarded-host':'attacker.invalid'}}),env);
 assert.equal(r.status,202);assert.equal(await r.text(),'original-app-api');
 assert.equal(calls,1);assert.equal(method,'POST');assert.equal(host,'newchanges-app.pages.dev');assert.equal(badHeader,null);
});
test('gateway handles missing backend and does not expose confidential errors',async()=>{
 const router=createNewChangesPagesGateway();
 const bad={...enable,NEWCHANGES_FULL_APP_SERVICE:{fetch:async()=>{throw Error('private PostgreSQL password')}}};
 const res=await router.fetch(make('/dashboard'),bad);
 assert.equal(res.status,503);assert.doesNotMatch(await res.text(),/password|private/);
});
