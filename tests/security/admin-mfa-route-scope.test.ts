import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {requiresAdminMfaStepUp} from '../../src/services/adminMfaRouteScope.js';

test('admin namespace always needs MFA for any API method', () => {
 for (const method of ['GET','POST','PATCH','DELETE']) {
  const p=requiresAdminMfaStepUp(method, '/api/admin/settings?tab=one');
  assert.equal(p.adminOnly,true);
  if(method!=='GET')assert.equal(p.adminMutation,true);
 }
});
test('all API mutations are covered, not just paths under /api/admin', () => {
 for (const method of ['POST','PUT','PATCH','DELETE']) {
  for(const path of ['/api/users','/api/users/abc','/api/users/abc/reset-password',
     '/api/report-schedules/abc/send-now','/api/report-schedules','/api/integrations']) {
    assert.equal(requiresAdminMfaStepUp(method,path).adminMutation,true,method+' '+path);
  }
 }
});
test('normal reads, MFA ceremony and login/reset endpoints are exempt from mutation gate', () => {
 for (const [m,p] of [
 ['GET','/api/report-schedules'],['POST','/api/auth/mfa/authenticate/verify'],
 ['POST','/api/auth/login'],['POST','/api/auth/logout'],
 ['POST','/api/auth/forgot-password'],['POST','/api/auth/set-password'],
 ['POST','/api/contact'],['POST','/dashboard']
 ])assert.deepEqual(requiresAdminMfaStepUp(m,p),{adminOnly:false,adminMutation:false});
});
test('no prefix-confusion /api/admin-escape is counted as admin namespace',()=>{
 assert.equal(requiresAdminMfaStepUp('GET','/api/admin-escape').adminOnly,false);
 assert.equal(requiresAdminMfaStepUp('POST','/api/admin-escape').adminMutation,true);
});
test('server uses classification in preHandler and keeps rollout opt-in',()=>{
 const s=readFileSync('src/server.ts','utf8');
 assert.match(s,/const MFA_ENFORCE = process\.env\.MFA_ENFORCE === "true" \|\| process\.env\.ADMIN_MFA_ENFORCE === "true"/);
 assert.match(s,/const scope = requiresAdminMfaStepUp\(req\.method, req\.url\)/);
 assert.match(s,/!scope\.adminOnly && !scope\.adminMutation && !protectedAppRead/);
 assert.match(s,/scope\.adminOnly && !isAdminRole\(user\)/);
 assert.match(s,/hasFreshAdminMfa\(req, user\.id\)/);
});

test('passkey-enrolled accounts cannot set up or verify TOTP',()=>{
 const source=readFileSync('src/services/adminMfaRoutes.ts','utf8');
 for(const action of ['setup','confirm','verify']){
  const marker="'/api/auth/mfa/totp/"+action+"'";
  const start=source.indexOf(marker);
  assert.notEqual(start,-1,'missing TOTP '+action+' route');
  assert.match(source.slice(start,start+700),
   /adminMfaCredential\.count\(\{where:\{userId:session\.userId,revokedAt:null\}\}\)[\s\S]{0,220}passkey-only MFA/);
 }
});
