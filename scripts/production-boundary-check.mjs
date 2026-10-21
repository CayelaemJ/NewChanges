import assert from 'node:assert/strict';
// Fastify injection exercises the complete routing/hook stack without a listener
// or a live database. It also works in restricted CI sandboxes.
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused?connect_timeout=1';
const { app } = await import('../dist/server.js');
// Test-only routes are registered here, never in the deployed application.
app.get('/__boundary-only/throw', async () => { throw new Error('postgresql://fixture:boundary-secret@fixture.invalid/db'); });
app.get('/__boundary-only/failure', async () => ({status:'FAILED',error:'mysql://fixture:boundary-secret@fixture.invalid/source',details:{password:'boundary-secret'}}));
const request = async (path, options = {}) => {
  const response = await app.inject({ method: options.method || 'GET', url: path, headers: options.headers });
  return { status: response.statusCode, headers: { get: key => response.headers[key] }, text: async () => response.body, json: async () => response.json() };
};
try {
  const thrown=await request('/__boundary-only/throw');
  assert.equal(thrown.status,500);
  assert.doesNotMatch(await thrown.text(),/boundary-secret|fixture.invalid|stack/);
  const failed=await request('/__boundary-only/failure');
  assert.equal(failed.status,200);
  assert.equal((await failed.json()).status,'FAILED');
  assert.doesNotMatch(await failed.text(),/boundary-secret|fixture.invalid/);
  const originalOfficer=process.env.INFORMATION_OFFICER;
  process.env.INFORMATION_OFFICER='<img src=x onerror=alert(1)>';
  try {
    const legal=await request('/privacy');const body=await legal.text();
    assert.doesNotMatch(body,/<img src=x onerror/);
    assert.match(body,/&lt;img src=x onerror=alert\(1\)&gt;/);
  }finally{if(originalOfficer===undefined)delete process.env.INFORMATION_OFFICER;else process.env.INFORMATION_OFFICER=originalOfficer;}
  for (const path of ['/static/admin.html', '/static/dashboard.html', '/static/users.html', '/static/%61dmin.html', '/static/.env', '/react/index.html', '/react/assets/app.js.map']) {
    const response = await request(path);
    assert.equal(response.status, 404, `${path} must not expose source documents`);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  for (const path of ['/dashboard', '/admin', '/users', '/react/', '/react/admin', '/react/dashboard']) {
    const response = await request(path);
    assert.equal(response.status, 302, `${path} requires sign-in`);
    assert.equal(response.headers.get('location'), '/login');
  }
  for (const path of ['/api/auth/me', '/api/users', '/api/portfolio', '/api/dashboard/first', '/api/dashboard/version', '/api/dashboard/events', '/api/admin/integration']) {
    const response = await request(path);
    assert.equal(response.status, 401, `${path} rejects anonymous access`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  for(const path of ['/','/privacy','/terms','/cookies','/contact','/login']){
    const response=await request(path);
    assert.equal(response.status,200,path+' is available');
    const html=await response.text();
    assert.doesNotMatch(html,/\{\{[A-Z_]+\}\}/,path+' has no unresolved template values');
    assert.doesNotMatch(html,/mailto:(?:the(?:%20| )portal|privacy(?:%20| )contact|legal(?:%20| )contact)/i,path+' has no fake email destination');
    if(path==='/')for(const href of ['/privacy','/terms','/contact','/login'])assert.ok(html.includes('href="'+href+'"'), 'landing navigation includes '+href);
    if(path==='/contact' && html.includes('data-availability="unavailable"'))assert.match(html,/<button[^>]*id="c-btn"[^>]*disabled/, 'unconfigured contact form cannot invite submissions');
  }
  const version = await (await request('/version')).json();
  assert.deepEqual(Object.keys(version).sort(), ['product', 'version']);
  const crossOrigin = await request('/api/auth/logout', {
    method: 'POST', headers: { origin: 'https://attacker.invalid', cookie: 'session=invalid' },
  });
  assert.equal(crossOrigin.status, 403, 'cross-origin cookie mutation is rejected');
  const resetPage = await request('/set-password?token=boundary-private-query-marker');
  assert.equal(resetPage.status, 200);
  assert.equal(resetPage.headers.get('referrer-policy'), 'no-referrer');
  assert.match(resetPage.headers.get('cache-control'), /no-store/);
  // Isolated session repository: exercise real guards without a database or
  // production identities. Audit writes are captured in memory as well.
  const { prisma: authPrisma } = await import('../dist/services/authService.js');
  let role='VIEWER', active=true, revoked=false;
  const originalFind=authPrisma.session.findUnique;
  const originalAudit=authPrisma.dataAccessEvent.create;
  authPrisma.session.findUnique=async()=>({
    id:'fixture-session',expiresAt:new Date(Date.now()+60_000),lastSeenAt:new Date(),
    endedAt:null,revokedAt:revoked?new Date():null,
    user:{id:'fixture-user',email:'fixture@example.invalid',name:'Fixture user',role,active,links:[{employerId:'assigned-fixture'}]},
  });
  authPrisma.dataAccessEvent.create=async()=>({id:'fixture-audit'});
  try {
    const headers={host:'localhost',cookie:'session=fixture-only-token',origin:'http://localhost'};
    for(role of ['VIEWER','EMPLOYER_MANAGER','PORTFOLIO_MANAGER']){
      for(const path of ['/admin','/react/admin'])assert.equal((await request(path,{headers})).status,403,role+' cannot open '+path);
      assert.equal((await request('/users',{headers})).status,302,role+' cannot open Users');
      for(const path of ['/api/users','/api/admin/integration','/api/admin/security/overview'])assert.equal((await request(path,{headers})).status,403,role+' cannot read '+path);
      for(const path of ['/api/users','/api/admin/reset-all'])assert.equal((await request(path,{headers,method:'POST'})).status,403,role+' cannot mutate '+path);
      for(const suffix of ['dashboard','periods','score-history'])assert.equal((await request('/api/employers/unassigned-fixture/'+suffix,{headers})).status,403,role+' cannot read another employer');
      assert.equal((await request('/dashboard',{headers})).status,200,role+' can reach dashboard shell');
    }
    for(role of ['ADMIN','SUPERADMIN']){
      for(const path of ['/admin','/users','/dashboard'])assert.equal((await request(path,{headers})).status,200,role+' can reach '+path);
    }
    process.env.STANDBY_MODE='true';
    try {
      role='SUPERADMIN';
      for(const path of ['/api/admin/integration/sync-now','/api/admin/integration/sync','/api/admin/integration/refresh']) {
        assert.equal((await request(path,{headers,method:'POST'})).status,423,'standby blocks '+path);
      }
      const {triggerRefreshNow}=await import('../dist/services/dailyRefresh.js');
      assert.equal((await triggerRefreshNow('manual')).status,'STANDBY','unconfirmed full refresh is blocked');
      for(const path of ['/api/admin/reset-all','/api/admin/integration/full-resync'])assert.equal((await request(path,{headers,method:'POST'})).status,400,'reset still requires RESET on standby');
    } finally {delete process.env.STANDBY_MODE;}
    active=false;
    assert.equal((await request('/api/users',{headers})).status,401,'inactive identity cannot authenticate');
    active=true;revoked=true;
    assert.equal((await request('/api/users',{headers})).status,401,'revoked session cannot authenticate');
    console.log('Role matrix passed: all five roles, employer isolation, mutation denial, inactive users and revoked sessions.');
  } finally {
    authPrisma.session.findUnique=originalFind;
    authPrisma.dataAccessEvent.create=originalAudit;
  }
  console.log('Production HTTP boundaries passed: protected pages, anonymous API rejection, static documents, source maps, CSRF, and cache headers.');
} finally { await app.close(); }
