import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

// Synthetic state tests. Never connect to real users, credentials or databases.
const html=readFileSync('public/admin-mfa.html','utf8');
const script=readFileSync('public/admin-mfa.js','utf8');
for(const id of ['mfa-passkey-verify-panel','mfa-passkey-enroll-panel','mfa-passkey-actions','totp-panel','mfa-success']){
  test('MFA page has state-controlled panel '+id,()=>{
    assert.match(html,new RegExp('id="'+id+'"'));
  });
}
async function check(state){
  const nodes=new Map();
  const getElementById=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:false,value:'',textContent:'',disabled:false,addEventListener(){},removeAttribute(){}});
    return nodes.get(id);
  };
  const document={getElementById,querySelector(){return {hidden:false}}};
  const context=createContext({
    document,window:{isSecureContext:false},navigator:{credentials:{}},
    fetch:async()=>({ok:true,json:async()=>state}),
    Uint8Array,atob,btoa,Error,JSON,PublicKeyCredential:undefined
  });
  runInContext(script,context);
  await runInContext('refresh()',context);
  return getElementById;
}
test('unenrolled administrator sees enrollment, not verification',async()=>{
  const el=await check({enrolled:false,verified:false,passkeyEnrolled:false,totpEnrolled:false,totpAvailable:true,canManageRecovery:false});
  assert.equal(el('mfa-passkey-enroll-panel').hidden,false);
  assert.equal(el('mfa-passkey-verify-panel').hidden,true);
  assert.equal(el('totp-verify-panel').hidden,true);
  assert.equal(el('mfa-success').hidden,true);
  assert.equal(el('recovery').hidden,true);
});
test('enrolled administrator sees verification, not another setup',async()=>{
  const el=await check({enrolled:true,verified:false,passkeyEnrolled:true,totpEnrolled:true,totpAvailable:true,canManageRecovery:false});
  assert.equal(el('mfa-passkey-enroll-panel').hidden,true);
  assert.equal(el('mfa-passkey-verify-panel').hidden,false);
  assert.equal(el('totp-start').hidden,true);
  assert.equal(el('totp-verify-panel').hidden,false);
});
test('verified administrator sees only completion state',async()=>{
  const el=await check({enrolled:true,verified:true,verificationMethod:'TOTP',passkeyEnrolled:true,totpEnrolled:true,totpAvailable:true,canManageRecovery:false});
  assert.equal(el('mfa-success').hidden,false);
  assert.equal(el('mfa-passkey-actions').hidden,true);
  assert.equal(el('totp-panel').hidden,true);
  assert.match(el('mfa-success-title').textContent,/verified/i);
});

test('returning authenticator-only admin is never asked to re-enter a setup grant',async()=>{
  const el=await check({enrolled:true,verified:false,passkeyEnrolled:false,totpEnrolled:true,totpAvailable:true,canManageRecovery:false});
  assert.equal(el('mfa-passkey-enroll-panel').hidden,true);
  assert.equal(el('mfa-passkey-verify-panel').hidden,true);
  assert.equal(el('mfa-passkey-actions').hidden,true);
  assert.equal(el('totp-grant').hidden,true);
  assert.equal(el('totp-start').hidden,true);
  assert.equal(el('totp-verify-panel').hidden,false);
  assert.match(el('totp-state').textContent,/No setup key or QR scan/i);
});
test('first-time authenticator setup offers private QR on demand',async()=>{
  const el=await check({enrolled:false,verified:false,passkeyEnrolled:false,totpEnrolled:false,totpAvailable:true,canManageRecovery:false});
  assert.equal(el('totp-grant').hidden,false);
  assert.equal(el('totp-start').hidden,false);
  assert.equal(el('totp-verify-panel').hidden,true);
  assert.match(el('totp-title').textContent,/QR code/i);
});

test('passkey enrollment clearly explains device-native PIN and biometric options',()=>{
 assert.match(html,/Windows Hello/);
 assert.match(html,/Face ID/);
 assert.match(html,/Touch ID/);
 assert.match(html,/FIDO2/);
 assert.match(html,/The Fixer never receives your PIN or biometric data/);
 assert.match(html,/id="enroll" type="button">Set up device passkey/);
});
