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
async function check(state,pathname='/mfa'){
  state={isAdministrator:true,...state};
  const nodes=new Map();
  const getElementById=id=>{
    if(!nodes.has(id)){
      const tag=html.match(new RegExp('<[^>]+\\bid="'+id+'"[^>]*>'))?.[0]||'';
      nodes.set(id,{hidden:/\bhidden(?:\s|>|=)/.test(tag),value:'',textContent:'',disabled:false,addEventListener(){},removeAttribute(){}});
    }
    return nodes.get(id);
  };
  const document={getElementById,querySelector(){return {hidden:false}}};
  const context=createContext({
    document,window:{isSecureContext:false,location:{pathname}},navigator:{credentials:{}},
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
  assert.equal(el('totp-verify-panel').hidden,true);
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
test('first-time administrator can start authenticator setup after password confirmation',async()=>{
  const el=await check({enrolled:false,verified:false,passkeyEnrolled:false,totpEnrolled:false,totpAvailable:true,canManageRecovery:false});
  assert.equal(el('totp-grant').hidden,true);
  assert.equal(el('totp-start').hidden,false);
  assert.equal(el('totp-start').disabled,false);
  assert.equal(el('mfa-approval-panel').hidden,false);
  assert.equal(el('mfa-self-enroll-form').hidden,false);
  assert.equal(el('totp-verify-panel').hidden,true);
  assert.match(el('totp-title').textContent,/QR code/i);
});
test('first-time regular account can enroll after password confirmation and can recover itself',async()=>{
 const el=await check({isAdministrator:false,enrolled:false,verified:false,passkeyEnrolled:false,
  totpEnrolled:false,totpAvailable:true,canManageRecovery:false});
 assert.equal(el('mfa-approval-panel').hidden,true);
 assert.equal(el('mfa-self-enroll-form').hidden,false);
 assert.equal(el('mfa-self-recovery').hidden,false);
 assert.equal(el('enroll').disabled,false);
 assert.equal(el('totp-start').disabled,false);
});

test('passkey enrollment clearly explains device-native PIN and biometric options',()=>{
 assert.match(html,/Windows Hello/);
 assert.match(html,/Face ID/);
 assert.match(html,/Touch ID/);
 assert.match(html,/FIDO2/);
 assert.match(html,/The Fixer never receives your PIN or biometric data/);
 assert.match(html,/id="enroll" type="button">Set up device passkey/);
});

test('verified authenticator user may add a Windows Hello passkey without a grant',async()=>{
 const el=await check({enrolled:true,verified:true,verificationMethod:'TOTP',
   passkeyEnrolled:false,totpEnrolled:true,totpAvailable:true,canManageRecovery:false},'/mfa/manage');
 assert.equal(el('mfa-manage-banner').hidden,false);
 assert.equal(el('mfa-passkey-enroll-panel').hidden,false);
 assert.equal(el('mfa-passkey-actions').hidden,false);
 assert.equal(el('grant').hidden,true);
 assert.equal(el('totp-panel').hidden,true);
});
test('verified passkey user sees passkey-only policy and no authenticator QR',async()=>{
 const el=await check({enrolled:true,verified:true,verificationMethod:'PASSKEY',
   passkeyEnrolled:true,totpEnrolled:false,totpAvailable:true,canManageRecovery:false},'/mfa/manage');
 assert.equal(el('mfa-manage-banner').hidden,false);
 assert.equal(el('totp-panel').hidden,true);
 assert.equal(el('totp-start').hidden,true);
 assert.equal(el('totp-grant').hidden,true);
 assert.equal(el('totp-verify-panel').hidden,true);
 assert.match(el('mfa-method-policy').textContent,/passkey is enrolled/i);
});
test('method manager refuses to display new enrollment before MFA verification',async()=>{
 const el=await check({enrolled:true,verified:false,passkeyEnrolled:false,
   totpEnrolled:true,totpAvailable:true,canManageRecovery:false},'/mfa/manage');
 assert.equal(el('mfa-manage-banner').hidden,true);
 assert.equal(el('mfa-passkey-enroll-panel').hidden,true);
 assert.equal(el('totp-verify-panel').hidden,false);
});

test('first-time administrator can self-enroll without a second administrator',async()=>{
 const el=await check({enrolled:false,verified:false,passkeyEnrolled:false,
  totpEnrolled:false,totpAvailable:true,canManageRecovery:false});
 assert.equal(el('mfa-approval-panel').hidden,false);
 assert.equal(el('grant').hidden,true);
 assert.equal(el('totp-grant').hidden,true);
 assert.equal(el('enroll').disabled,false);
 assert.equal(el('totp-start').disabled,false);
 assert.equal(el('mfa-self-enroll-form').hidden,false);
 assert.match(html,/id="mfa-approval-request"/);
 assert.match(script,/\/api\/auth\/mfa\/enrollment\/status/);
 assert.match(script,/enrollment\/request/);
});
test('once enrolled, the first-time approval panel disappears',async()=>{
 const el=await check({enrolled:true,verified:false,passkeyEnrolled:false,
  totpEnrolled:true,totpAvailable:true,canManageRecovery:false});
 assert.equal(el('mfa-approval-panel').hidden,true);
 assert.equal(el('totp-verify-panel').hidden,false);
});
test('independent superadmin enrollment approval UI requires fresh recovery authority',async()=>{
 const el=await check({enrolled:true,verified:true,verificationMethod:'PASSKEY',
  passkeyEnrolled:true,totpEnrolled:false,totpAvailable:true,canManageRecovery:true},'/mfa/manage');
 assert.equal(el('mfa-approval-admin').hidden,false);
 assert.match(html,/mfa-approval-confirm-identity/);
 assert.match(script,/identityConfirmed:true/);
});

test('TOTP-verified superadmin may step up with existing passkey before approval',async()=>{
 const el=await check({enrolled:true,verified:true,verificationMethod:'TOTP',
  passkeyEnrolled:true,totpEnrolled:true,totpAvailable:true,canManageRecovery:false},'/mfa/manage');
 assert.equal(el('mfa-passkey-verify-panel').hidden,false);
 assert.equal(el('mfa-passkey-actions').hidden,false);
 assert.equal(el('mfa-approval-admin').hidden,true);
});

test('existing MFA admin missing backup key is prompted to issue it before continuing',async()=>{
 const el=await check({enrolled:true,verified:true,hasRecoveryKey:false,
  verificationMethod:'PASSKEY',passkeyEnrolled:true,totpEnrolled:true,
  totpAvailable:true,canManageRecovery:true});
 assert.equal(el('mfa-existing-recovery-key').hidden,false);
 assert.equal(el('mfa-continue').hidden,true);
 assert.equal(el('mfa-manage-link').hidden,true);
 assert.match(el('mfa-success-note').textContent,/Generate and securely save/);
});
test('existing MFA admin with issued backup key may continue normally',async()=>{
 const el=await check({enrolled:true,verified:true,hasRecoveryKey:true,
  verificationMethod:'PASSKEY',passkeyEnrolled:true,totpEnrolled:true,
  totpAvailable:true,canManageRecovery:true});
 assert.equal(el('mfa-existing-recovery-key').hidden,true);
 assert.equal(el('mfa-continue').hidden,false);
 assert.equal(el('mfa-manage-link').hidden,false);
});
