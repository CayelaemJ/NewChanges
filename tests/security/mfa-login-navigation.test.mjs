import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const server=readFileSync('src/server.ts','utf8');
const login=readFileSync('public/login.html','utf8');
test('password login returns MFA-required routing for administrative accounts only',()=>{
 assert.match(server,/mfaRequired: MFA_ENFORCE && isAdminRole\(result\.user\)/);
 assert.match(server,/next: MFA_ENFORCE && isAdminRole\(result\.user\) \? "\/mfa"/);
 assert.match(login,/if\(d\.mfaRequired===true && d\.next==='\/mfa'\)/);
 assert.match(login,/location\.assign\('\/mfa'\)/);
 assert.doesNotMatch(login,/addEventListener\('keydown',\s*e\s*=>\s*\{\s*if\(e\.key==='Enter'\) signIn\(\)/);
});
test('browser pages cannot bypass passkey step-up after password login',()=>{
 const dashboard=server.slice(server.indexOf('app.get("/dashboard"'),server.indexOf('app.get("/admin"'));
 assert.match(dashboard,/MFA_ENFORCE && isAdminRole\(user\) && !await hasFreshAdminMfa\(req, user\.id\)/);
 assert.match(dashboard,/return reply\.redirect\("\/mfa"\)/);
 for(const path of ['/react/','/react/admin','/react/dashboard']){
  const start=server.indexOf('app.get("'+path+'"');
  assert.ok(start>=0,'React route must exist '+path);
  const end=server.indexOf('\napp.get(',start+5);
  const scope=server.slice(start,end>start?end:start+1000);
  assert.match(scope,/hasFreshAdminMfa\(req, user\.id\)/);
 }
 assert.match(server,/app.get\("\/mfa", async \(req, reply\) =>/);
 assert.match(server,/if \(!user \|\| !isAdminRole\(user\)\) return reply\.redirect\("\/login"\)/);
});

test('MFA ceremony routes users according to login and verification status',()=>{
 const start=server.indexOf('app.get("/mfa",');
 const end=server.indexOf('\napp.get(',start+8);
 assert.ok(start>=0,'MFA route must exist');
 const route=server.slice(start,end>start?end:start+900);
 assert.match(route,/if \(!user \|\| !isAdminRole\(user\)\) return reply\.redirect\("\/login"\)/);
 assert.match(route,/MFA_ENFORCE && await hasFreshAdminMfa\(req, user\.id\)/);
 assert.match(route,/return reply\.redirect\("\/dashboard"\)/);
 assert.match(route,/return serveHtml\(reply, "admin-mfa\.html"\)/);
});
