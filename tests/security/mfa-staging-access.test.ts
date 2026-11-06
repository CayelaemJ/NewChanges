import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {COOKIE_NAME,createMfaStagingCookie,isMfaStagingCookieValid,
 isMfaStagingPasswordValid,isMfaStagingAccessValid} from '../../src/services/mfaStagingGate.js';

const pass='independent-synthetic-access-password-32+';
const now=1793617800000;

test('staging gate accepts a correct password and preserves CLI Basic fallback',()=>{
 assert.equal(isMfaStagingPasswordValid(pass,pass),true);
 assert.equal(isMfaStagingPasswordValid(pass,'wrong-pass'),false);
 assert.equal(isMfaStagingPasswordValid(pass,'short'),false);
 assert.equal(isMfaStagingAccessValid('Basic '+Buffer.from('mfa-staging:'+pass).toString('base64'),pass),true);
 assert.equal(isMfaStagingAccessValid('Bearer '+pass,pass),false);
});
test('staging browser cookie is signed, time-bounded, host-only and password-bound',()=>{
 const token=createMfaStagingCookie(pass,now);
 assert.ok(token);
 const header=COOKIE_NAME+'='+token+'; session=irrelevant';
 assert.equal(isMfaStagingCookieValid(header,pass,now+1000),true);
 assert.equal(isMfaStagingCookieValid(header,pass,now+4*60*60*1000),true);
 assert.equal(isMfaStagingCookieValid(header,pass,now+4*60*60*1000+1),false);
 assert.equal(isMfaStagingCookieValid(header,pass,now-31000),false);
 assert.equal(isMfaStagingCookieValid(header,pass+'different',now),false);
 assert.equal(isMfaStagingCookieValid(header.replace(/.$/,'x'),pass,now),true,
  'Unrelated session-cookie content must not affect staging gate');
 const mutated=token.slice(0,-1)+(token.endsWith('a')?'b':'a');
 assert.equal(isMfaStagingCookieValid(COOKIE_NAME+'='+mutated,pass,now),false);
 assert.equal(isMfaStagingCookieValid(undefined,pass,now),false);
 assert.equal(createMfaStagingCookie('short',now),null);
});
test('branded staging form only accepts server-side credential verification',()=>{
 const html=readFileSync('public/staging-access.html','utf8');
 const js=readFileSync('public/staging-access.js','utf8');
 const server=readFileSync('src/server.ts','utf8');
 assert.match(html,/type="password"/);
 assert.match(html,/id="staging-password"/);
 assert.match(html,/The Fixer/i);
 assert.match(js,/fetch\("\/staging-access"/);
 assert.match(js,/window\.location\.assign\("\/login"\)/);
 assert.doesNotMatch(js,/localStorage|sessionStorage|document\.cookie/i);
 assert.match(server,/MFA_STAGING_ONLY === "true"/);
 assert.match(server,/req\.headers\.origin !== stagingOrigin/);
 assert.match(server,/isMfaStagingCookieValid\(req\.headers\.cookie/);
 assert.match(server,/stagingAccessFailures\.hit/);
 assert.match(server,/Max-Age=14400; Secure; HttpOnly; SameSite=Strict/);
 assert.match(server,/Location", "\/staging-access"/);
 assert.match(server,/if \(path === "\/health" && req\.method === "GET"\)/);
 assert.match(server,/path\.startsWith\("\/api\/"\)/);
});
