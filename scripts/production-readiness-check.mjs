import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pub = path.join(root, 'public');
const pages = fs.readdirSync(pub).filter(f => f.endsWith('.html'));
const required = ['home.html','404.html','contact.html','privacy.html','terms.html','cookies.html','thank-you.html','login.html','dashboard.html','admin.html','users.html','set-password.html'];
const errors = [];
for (const f of required) if (!fs.existsSync(path.join(pub,f))) errors.push(`missing page: ${f}`);
for (const f of pages) {
  const s = fs.readFileSync(path.join(pub,f),'utf8');
  if (!/<title>[^<]+<\/title>/i.test(s)) errors.push(`${f}: missing title`);
  if (!/<meta\s+name=["']description["'][^>]+content=["'][^"']+/i.test(s)) errors.push(`${f}: missing meta description`);
  if (!/property=["']og:image["']/i.test(s)) errors.push(`${f}: missing Open Graph image`);
  for (const m of s.matchAll(/<img\b[^>]*>/gi)) if (!/\balt\s*=/i.test(m[0])) errors.push(`${f}: image missing alt text`);
}
for (const f of ['favicon.ico','favicon-16.png','favicon-32.png','apple-touch-icon.png','og-image.png','site.webmanifest','enterprise-v3.css','dashboard.css','home.html']) if (!fs.existsSync(path.join(pub,f))) errors.push(`missing public asset: ${f}`);
const server = fs.readFileSync(path.join(root,'src/server.ts'),'utf8');
for (const needle of ['robots.txt','sitemap.xml','setNotFoundHandler','Strict-Transport-Security','X-Content-Type-Options','Content-Security-Policy','/api/auth/login']) if (!server.includes(needle)) errors.push(`server missing security/SEO control: ${needle}`);
for (const needle of ['COOKIE_SECURE','httpOnly: true','sameSite: "lax"','rateLimit']) if (!server.includes(needle)) errors.push(`server missing auth control: ${needle}`);
const auth = fs.readFileSync(path.join(root,'src/services/authService.ts'),'utf8');
if (!auth.includes('scryptSync') || !auth.includes('timingSafeEqual')) errors.push('auth service missing password hashing controls');
const badPlaceholders = [];
for (const f of pages) {
  const s = fs.readFileSync(path.join(pub,f),'utf8');
  if (/\[(?:DATE|COMPANY LEGAL NAME|ADDRESS|REG NUMBER)\]/.test(s)) badPlaceholders.push(f);
}
if (badPlaceholders.length) errors.push(`unresolved legal placeholders: ${badPlaceholders.join(', ')}`);
if (errors.length) { console.error('PRODUCTION READINESS: FAIL'); for (const e of errors) console.error(' -',e); process.exit(1); }
console.log(`PRODUCTION READINESS: PASS (${required.length} required pages, ${pages.length} HTML files audited)`);
