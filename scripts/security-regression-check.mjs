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
assert.match(auth, /parts\.length !== 2/, 'malformed hashes must not be accepted');
assert.match(auth, /\^\[0-9a-fA-F\]\{128\}\$/, 'stored digest must be strictly validated');
assert.match(auth, /catch \{\s*return false;\s*\}/, 'scrypt failures must fail authentication safely');
assert.match(auth, /digestSetupToken/);
assert.match(users, /password must be at least 12 characters/);
// Permissions and session revocation must commit together. The old test
// expected revocation before the update, which left a partial-failure window.
const updateStart = users.indexOf("export async function updateUser(");
const updateEnd = users.indexOf("// self-service: a user disables", updateStart);
assert.ok(updateStart >= 0 && updateEnd > updateStart, "updateUser boundary must exist");
const updateUserBody = users.slice(updateStart, updateEnd);
assert.match(updateUserBody, /const accessChanged = patch\.role !== undefined/, 'role changes must revoke sessions');
assert.match(updateUserBody, /patch\.employerIds !== undefined/, 'employer scope changes must revoke sessions');
assert.match(updateUserBody, /return prisma\.\$transaction\(async tx =>/, 'permission updates must be transactional');
assert.match(updateUserBody, /await tx\.user\.updateMany\(/, 'role update must occur in the transaction');
assert.match(updateUserBody, /await tx\.userEmployer\.deleteMany\(/, 'employer replacement must occur in the transaction');
assert.match(updateUserBody, /if \(accessChanged\) \{[\s\S]*?await tx\.session\.updateMany\(/, 'access changes must revoke sessions in the same transaction');
assert.match(updateUserBody, /revokedBy: "admin_permission_changed"/, 'session revocation must be attributable');
assert.doesNotMatch(updateUserBody, /await destroyAllSessionsForUser\(/, 'session revocation must not be a separate non-atomic operation');
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
assert.match(server, /sameHostOrigin/, "CSRF must compare against the actual request host");
assert.match(fs.readFileSync('src/services/partnerService.ts', 'utf8'), /name is required \(max 120 characters\)/, 'createPartner must validate input');
assert.match(server, /could not create partner/, 'partner create must return 400 on invalid input');
assert.match(server, /could not update partner/, 'partner update must return 400 on invalid input');
assert.match(fs.readFileSync('public/admin.html', 'utf8'), /async function apiOk\(/, 'admin must surface server errors on partner writes');
assert.match(fs.readFileSync('public/home.html', 'utf8'), /Illustrative sample/, 'landing page figures must be labelled as illustrative');
console.log('Security regression checks passed.');

assert.match(fs.readFileSync("src/services/sourceAdapter.ts", "utf8"), /SOURCE_API_ALLOWED_HOSTS/);
assert.match(fs.readFileSync("src/services/sourceAdapter.ts", "utf8"), /privateOrLocalAddress/);
// Source API now uses Node HTTPS with DNS answers pinned into the TLS
// connection. The previous fetch redirect flag is no longer the protection.
const sourceAdapter = fs.readFileSync("src/services/sourceAdapter.ts", "utf8");
const pinnedHttps = fs.readFileSync("src/services/pinnedSourceHttps.ts", "utf8");
assert.match(sourceAdapter, /readPinnedSourceApiJson\(url, token\)/, "API reads must use the pinned HTTPS transport");
assert.match(pinnedHttps, /lookup: pinnedSourceLookup\(hostname, answers\)/, "TLS must use validated DNS answers");
assert.match(pinnedHttps, /rejectUnauthorized: true/, "source TLS verification must remain enabled");
assert.match(pinnedHttps, /url\.protocol !== "https:"/, "source API must reject non-HTTPS URLs");

assert.match(fs.readFileSync("public/dashboard.css", "utf8"), /Canonical mobile stabilization/);
assert.match(fs.readFileSync("public/dashboard.css", "utf8"), /max-width: 640px/);

// Proxy trust must be explicitly enabled and constrained to a single ingress hop.
assert.match(server, /trustProxy: \(address: string, hop: number\) => process\.env\.TRUST_PROXY === "true" && hop === 1/);
assert.doesNotMatch(server, /String\(req\.headers\["x-forwarded-proto"\]/);

// Each API report request must re-check its destination before fetching.
assert.match(fs.readFileSync("src/services/sourceAdapter.ts", "utf8"), /await assertSafeApiBaseUrl\(url\.toString\(\)\)/);

assert.ok(server.includes("const hasSessionCookie = /(?:^|;\\s*)session=/"), "cookie-based CSRF guard must check the raw Cookie header");
assert.ok(server.includes("if (hasSessionCookie || !req.headers.authorization)"), "Authorization header must not bypass cookie CSRF validation");
assert.equal(server.split("payload.theme = isAdminRole(user)").length - 1, 2, "both dashboard routes must keep admin branding stable");
assert.ok(fs.readFileSync("src/services/sectionService.ts", "utf8").includes("VALID_ROLES.has(role)"), "role permissions must be validated");
