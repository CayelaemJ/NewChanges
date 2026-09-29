import fs from 'node:fs';
import assert from 'node:assert/strict';

const server = fs.readFileSync('src/server.ts', 'utf8');
const auth = fs.readFileSync('src/services/authService.ts', 'utf8');
const users = fs.readFileSync('src/services/userService.ts', 'utf8');
const dashboard = fs.readFileSync('public/dashboard.html', 'utf8');
const partners = fs.readFileSync('src/services/partnerService.ts', 'utf8');

assert.match(server, /X-Content-Type-Options/);
assert.match(server, /Content-Security-Policy/);
assert.match(server, /cross-origin request rejected/);
assert.match(server, /AUTH_RATE_LIMIT/);
assert.match(server, /canViewEmployer\(user, req\.params\.employerId\)/);
assert.match(auth, /timingSafeEqual/);
assert.match(auth, /digestSetupToken/);
assert.match(users, /password must be at least 12 characters/);
assert.match(users, /destroyAllSessionsForUser\(userId\)/);
assert.match(dashboard, /dashboard\.css/);
assert.doesNotMatch(dashboard, /responsive-v1\.css|responsive-v2\.css|ui-enhance-v1\.css|ui-enhance-v2\.css/);
assert.match(server, /trustProxy/);
assert.match(server, /you cannot deactivate or demote your own account/);
assert.match(server, /valid type and path are required/);
assert.match(auth, /digestSession/);
assert.match(auth, /DUMMY_HASH/);
assert.match(partners, /six-digit hexadecimal colour/);
assert.match(partners, /1_500_000/);
assert.match(partners, /data:image\\\//);
for (const page of ['dashboard', 'admin', 'users']) {
  const html = fs.readFileSync(`public/${page}.html`, 'utf8');
  assert.match(html, /\/static\/safe\.js/, `${page}.html must load safe.js`);
  assert.match(html, /\$\{esc\(/, `${page}.html must escape interpolated data`);
}
assert.match(server, /setNotFoundHandler/);
assert.match(server, /honeypot/);
assert.match(server, /PUBLIC_PATHS/);
for (const f of ['404', 'contact', 'thank-you', 'login', 'privacy', 'terms', 'cookies']) {
  const html = fs.readFileSync(`public/${f}.html`, 'utf8');
  assert.match(html, /<title>[^<]{10,}<\/title>/, `${f}: title`);
  assert.match(html, /name="description"/, `${f}: description`);
  assert.match(html, /og:image"/, `${f}: og:image`);
  assert.doesNotMatch(html, /example\.com|\[EMAIL\]|\[NAME\]/, `${f}: placeholder contact left in page`);
}
for (const f of ['robots.txt', 'sitemap.xml']) assert.match(server, new RegExp(f.replace('.', '\\.')));
for (const a of ['og-image.png', 'favicon.ico', 'apple-touch-icon.png', 'site.webmanifest', 'shell.js', 'enterprise.css']) assert.ok(fs.existsSync(`public/${a}`), a);
// v0.10.0 review fixes
assert.doesNotMatch(server, /public, max-age=31536000/, 'unversioned static assets must not get a one-year cache');
assert.match(server, /hostOrigin/, 'CSRF check must accept the request host origin as well as PUBLIC_BASE_URL');
assert.match(fs.readFileSync('src/services/partnerService.ts', 'utf8'), /name is required \(max 120 characters\)/, 'createPartner must validate input');
assert.match(server, /could not create partner/, 'partner create must return 400 on invalid input');
assert.match(server, /could not update partner/, 'partner update must return 400 on invalid input');
assert.match(fs.readFileSync('public/admin.html', 'utf8'), /async function apiOk\(/, 'admin must surface server errors on partner writes');
assert.match(fs.readFileSync('public/home.html', 'utf8'), /Illustrative sample/, 'landing page figures must be labelled as illustrative');
console.log('Security regression checks passed.');

assert.match(fs.readFileSync("src/services/sourceAdapter.ts", "utf8"), /SOURCE_API_ALLOWED_HOSTS/);
assert.match(fs.readFileSync("src/services/sourceAdapter.ts", "utf8"), /privateOrLocalAddress/);
assert.match(fs.readFileSync("src/services/sourceAdapter.ts", "utf8"), /redirect: "error"/);

assert.match(fs.readFileSync("public/dashboard.css", "utf8"), /Canonical mobile stabilization/);
assert.match(fs.readFileSync("public/dashboard.css", "utf8"), /max-width: 640px/);
