import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare-output/newchanges-isolated-preview.worker.mjs';

const url=p=>'https://migration.newchanges-app.pages.dev'+p;

test('preview serves real public NewChanges homepage without Render or cookies', async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=()=>{throw new Error('No external API requests allowed');};
  try {
    const r=await worker.fetch(new Request(url('/'),{headers:{Cookie:'sensitive=blocked',Authorization:'Bearer blocked'}}));
    assert.equal(r.status,200);
    assert.match(r.headers.get('content-type'),/text\/html/);
    assert.match(r.headers.get('x-robots-tag'),/noindex/);
    assert.match(r.headers.get('content-security-policy'),/connect-src 'none'/);
    assert.equal(r.headers.get('set-cookie'),null);
    const html=await r.text();
    assert.match(html,/The Fixer \(Pty\) Ltd/);
    assert.match(html,/Cloudflare staging preview only/);
    assert.doesNotMatch(html,/\{\{BASE_URL\}\}/);
    assert.match(html,/noindex,nofollow,noarchive/);
    assert.doesNotMatch(html,/name="robots" content="index,follow"/);
  }finally{globalThis.fetch=old;}
});

test('staging serves branding and public legal copy',async()=>{
  for(const p of ['/privacy','/terms','/cookies','/static/the-fixer-logo-reversed.svg','/static/the-fixer-brand.css']){
    const r=await worker.fetch(new Request(url(p)));
    assert.equal(r.status,200,p);
    assert.ok((await r.text()).length>100,p);
  }
});

test('preview never exposes account forms, admin or API even with cookies',async()=>{
  for(const p of ['/login','/contact','/admin','/dashboard','/users','/react/','/set-password']){
    const r=await worker.fetch(new Request(url(p),{headers:{Cookie:'session=secret'}}));
    assert.equal(r.status,403,p);
    assert.match(r.headers.get('cache-control'),/no-store/);
  }
  for(const p of ['/api/auth/login','/api/auth/me','/api/dashboards','/api']){
    const r=await worker.fetch(new Request(url(p)));
    assert.equal(r.status,404,p);
  }
  assert.equal((await worker.fetch(new Request(url('/api/dashboards'),{method:'POST'}))).status,404);
  assert.equal((await worker.fetch(new Request(url('/'),{method:'POST'}))).status,405);
  assert.equal((await worker.fetch(new Request(url('/__private')))).status,404);
});

test('robots and HEAD are safe',async()=>{
  const robots=await worker.fetch(new Request(url('/robots.txt')));
  assert.match(await robots.text(),/Disallow: \/\s*$/m);
  const head=await worker.fetch(new Request(url('/'),{method:'HEAD'}));
  assert.equal(head.status,200);
  assert.equal(await head.text(),'');
});

test('legacy favicon routes and web manifest do not depend on Render',async()=>{
 for(const p of ['/favicon.ico','/static/favicon-16.png','/static/favicon-32.png','/static/apple-touch-icon.png']){
  const r=await worker.fetch(new Request(url(p)));
  assert.equal(r.status,302,p);
  assert.equal(r.headers.get('location'),'/static/the-fixer-icon.svg');
 }
 const r=await worker.fetch(new Request(url('/static/site.webmanifest')));
 assert.equal(r.status,200);
 assert.match(await r.text(),/The Fixer/);
});
test('HEAD or malformed API requests cannot bypass the private route boundary',async()=>{
 for(const p of ['/api/auth/me','/api/admin','/api/source-sync','/auth/me']){
  for(const method of ['GET','HEAD','POST']){
   const r=await worker.fetch(new Request(url(p),{method,headers:{Authorization:'Bearer synthetic-should-not-pass'}}));
   assert.equal(r.status,404,p+' '+method);
   assert.equal(r.headers.get('set-cookie'),null);
  }
 }
});

test('Pages migration health and readiness do not claim production status',async()=>{
 const health=await worker.fetch(new Request(url('/api/health')));
 assert.deepEqual(await health.json(),{status:'ok',environment:'cloudflare-pages-preview',production:false});
 const capabilities=await worker.fetch(new Request(url('/api/migration/capabilities')));
 const data=await capabilities.json();
 assert.equal(data.database,'disconnected');
 assert.equal(data.auth,'disabled');
 const ready=await worker.fetch(new Request(url('/api/migration/readiness')));
 const state=await ready.json();
 assert.equal(state.primaryReady,false);
});
