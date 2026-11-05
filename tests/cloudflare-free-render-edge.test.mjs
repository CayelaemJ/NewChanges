import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import worker, { evaluateFreeEdgeConfig } from '../cloudflare/free-edge/worker.mjs';

const good = {
  NEWCHANGES_FREE_EDGE_ENABLED: 'true',
  NEWCHANGES_CANONICAL_HOST: 'fixer.example.org',
  NEWCHANGES_RENDER_ORIGIN: 'https://newchanges-example.onrender.com',
};
test('free edge is disabled by default in Wrangler and has no route', () => {
  const cfg = JSON.parse(readFileSync(new URL('../wrangler.newchanges-free.jsonc', import.meta.url), 'utf8'));
  assert.equal(cfg.vars.NEWCHANGES_FREE_EDGE_ENABLED,'false');
  assert.equal(cfg.vars.NEWCHANGES_RENDER_ORIGIN,'');
  assert.equal(cfg.workers_dev,false);
  assert.equal('routes' in cfg,false);
  assert.equal('containers' in cfg,false);
});
test('free edge fails closed without approved hostname and HTTPS Render origin', () => {
  for (const input of [
    {...good, NEWCHANGES_FREE_EDGE_ENABLED: 'false'},
    {...good, NEWCHANGES_CANONICAL_HOST: ''},
    {...good, NEWCHANGES_RENDER_ORIGIN: 'http://newchanges-example.onrender.com'},
    {...good, NEWCHANGES_RENDER_ORIGIN: 'https://attacker.com'},
    {...good, NEWCHANGES_RENDER_ORIGIN: 'https://newchanges-example.onrender.com.evil.test'},
    {...good, NEWCHANGES_RENDER_ORIGIN: 'https://admin:secret@newchanges-example.onrender.com'},
    {...good, NEWCHANGES_RENDER_ORIGIN: 'https://newchanges-example.onrender.com/bad'},
  ]) assert.equal(evaluateFreeEdgeConfig(input,'fixer.example.org').ready,false);
  assert.equal(evaluateFreeEdgeConfig(good,'other.example.org').ready,false);
  assert.equal(evaluateFreeEdgeConfig(good,'fixer.example.org').ready,true);
});
test('disabled public request returns 503 and never invokes upstream', async () => {
  const response = await worker.fetch(new Request('https://fixer.example.org/admin'), {...good, NEWCHANGES_FREE_EDGE_ENABLED:'false'});
  assert.equal(response.status,503);
});
test('health/status route has no secret or backend hostname', async () => {
  const response = await worker.fetch(new Request('https://fixer.example.org/__migration/status'),good);
  const body = await response.text();
  assert.equal(response.status,200);
  assert.doesNotMatch(body,/onrender|postgres|secret|password/);
});
test('proxy retains cookies, request path and method, and rewrites same-origin redirects', async () => {
  const originalFetch=globalThis.fetch;
  let call;
  globalThis.fetch=async (request) => {
    call=request;
    return new Response('redirect',{status:302,headers:{
      'Location':'https://newchanges-example.onrender.com/auth/login?next=%2Fadmin',
      'Set-Cookie':'session=opaque; Path=/; HttpOnly; Secure; SameSite=Lax'
    }});
  };
  try {
    const request = new Request('https://fixer.example.org/api/test?q=1', {
      method:'POST',headers:{cookie:'session=test','x-forwarded-host':'spoofed.example','x-forwarded-for':'127.0.0.1'},body:'synthetic'
    });
    const response=await worker.fetch(request,good);
    assert.equal(call.url,'https://newchanges-example.onrender.com/api/test?q=1');
    assert.equal(call.method,'POST');
    assert.equal(call.headers.get('cookie'),'session=test');
    assert.equal(call.headers.get('x-forwarded-host'),'fixer.example.org');
    assert.equal(call.headers.get('x-forwarded-for'),null);
    assert.equal(await call.text(),'synthetic');
    assert.equal(response.status,302);
    assert.equal(response.headers.get('location'),'https://fixer.example.org/auth/login?next=%2Fadmin');
    assert.match(response.headers.get('set-cookie'),/HttpOnly/);
    assert.equal(response.headers.get('cache-control'),'no-store');
  } finally { globalThis.fetch=originalFetch; }
});
test('Render candidate cannot auto deploy or silently receive a production database URL', () => {
  const y=readFileSync(new URL('../render.free-candidate.yaml',import.meta.url),'utf8');
  assert.match(y,/plan: free/);
  assert.match(y,/autoDeployTrigger: off/);
  assert.match(y,/STANDBY_MODE\n\s+value: "true"/);
  assert.match(y,/DATABASE_URL\n\s+sync: false/);
  assert.doesNotMatch(y,/postgresql:\/\//);
});
