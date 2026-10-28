import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../cloudflare-output/newchanges-isolated-preview.worker.mjs';

const url=p=>'https://newchanges-cloudflare-preview.cabo-solutions-za.workers.dev'+p;

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
