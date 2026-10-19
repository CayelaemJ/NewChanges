import assert from 'node:assert/strict';
// Fastify injection exercises the complete routing/hook stack without a listener
// or a live database. It also works in restricted CI sandboxes.
process.env.DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused?connect_timeout=1';
const { app } = await import('../dist/server.js');
const request = async (path, options = {}) => {
  const response = await app.inject({ method: options.method || 'GET', url: path, headers: options.headers });
  return { status: response.statusCode, headers: { get: key => response.headers[key] }, json: async () => response.json() };
};
try {
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
  for (const path of ['/api/auth/me', '/api/users', '/api/portfolio', '/api/dashboard/first', '/api/admin/integration']) {
    const response = await request(path);
    assert.equal(response.status, 401, `${path} rejects anonymous access`);
    assert.equal(response.headers.get('cache-control'), 'no-store');
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
  console.log('Production HTTP boundaries passed: protected pages, anonymous API rejection, static documents, source maps, CSRF, and cache headers.');
} finally { await app.close(); }
