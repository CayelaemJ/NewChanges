'use strict';
const statusEl=document.getElementById('status');
const verifyBtn=document.getElementById('verify');
const enrollBtn=document.getElementById('enroll');
const grantEl=document.getElementById('grant');
const managingMethods=window.location?.pathname==='/mfa/manage';
let enrollmentApproved=false;
let enrollmentRequestId=null;
let legacyGrant='';
let accountIsAdministrator=false;
function show(message){statusEl.textContent=message;}
function displayRecoveryKey(key){
 if(typeof key!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(key))return;
 const panel=document.getElementById('mfa-backup-key');
 document.getElementById('mfa-backup-value').textContent=key;
 document.getElementById('mfa-backup-confirm').checked=false;
 document.getElementById('mfa-backup-dismiss').disabled=true;
 document.getElementById('mfa-continue').hidden=true;
 panel.hidden=false;
 panel.scrollIntoView?.({behavior:'smooth',block:'center'});
}

async function api(path,data){
 const response=await fetch('/api/auth/mfa/'+path,{method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(data||{})});
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(body.error||'Security request rejected');
 return body;
}
function browserSupported(){
 return window.isSecureContext && typeof PublicKeyCredential!=='undefined' && !!navigator.credentials;
}
function fromBase64Url(value){
 if(typeof value!=='string' || !/^[A-Za-z0-9_-]+$/.test(value))throw Error('Invalid passkey options');
 const normalized=value.replace(/-/g,'+').replace(/_/g,'/');
 const bytes=atob(normalized+'='.repeat((4-normalized.length%4)%4));
 return Uint8Array.from(bytes,chr=>chr.charCodeAt(0));
}
function toBase64Url(data){
 const bytes=new Uint8Array(data);
 let str='';
 for(let i=0;i<bytes.length;i++)str+=String.fromCharCode(bytes[i]);
 return btoa(str).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
function creationOptions(options){
 if(typeof PublicKeyCredential.parseCreationOptionsFromJSON==='function')
  return PublicKeyCredential.parseCreationOptionsFromJSON(options);
 return {
  ...options,challenge:fromBase64Url(options.challenge),
  user:{...options.user,id:fromBase64Url(options.user.id)},
  excludeCredentials:(options.excludeCredentials||[]).map(c=>({...c,id:fromBase64Url(c.id)})),
 };
}
function requestOptions(options){
 if(typeof PublicKeyCredential.parseRequestOptionsFromJSON==='function')
  return PublicKeyCredential.parseRequestOptionsFromJSON(options);
 return {...options,challenge:fromBase64Url(options.challenge),
  allowCredentials:(options.allowCredentials||[]).map(c=>({...c,id:fromBase64Url(c.id)}))};
}
function serialize(credential){
 if(typeof credential?.toJSON==='function')return credential.toJSON();
 if(!credential?.response || credential.type!=='public-key')throw Error('Invalid passkey response');
 const base={id:credential.id,rawId:toBase64Url(credential.rawId),type:'public-key',
  authenticatorAttachment:credential.authenticatorAttachment||undefined,
  clientExtensionResults:credential.getClientExtensionResults?.()||{}};
 const response={clientDataJSON:toBase64Url(credential.response.clientDataJSON)};
 if(credential.response.attestationObject){
  response.attestationObject=toBase64Url(credential.response.attestationObject);
  response.transports=credential.response.getTransports?.()||[];
 }else{
  if(!credential.response.authenticatorData || !credential.response.signature)
   throw Error('Incomplete passkey authentication response');
  response.authenticatorData=toBase64Url(credential.response.authenticatorData);
  response.signature=toBase64Url(credential.response.signature);
  response.userHandle=credential.response.userHandle
   ?toBase64Url(credential.response.userHandle):null;
 }
 return {...base,response};
}
async function refresh(){
 try{
  const res=await fetch('/api/auth/mfa/status',{credentials:'same-origin'});
  if(!res.ok)throw Error('Please sign in to continue');
  const state=await res.json();
  const firstTime=!state.enrolled&&!state.verified&&!managingMethods;
  accountIsAdministrator=state.isAdministrator===true;
  document.querySelector('header strong').textContent=accountIsAdministrator
    ? 'THE FIXER · ADMIN SECURITY' : 'THE FIXER · ACCOUNT SECURITY';
  document.querySelector('h1').textContent=accountIsAdministrator
    ? 'Protect your administrator account' : 'Protect your account';
  const missingRecovery=!!state.verified && !!state.enrolled && !state.hasRecoveryKey;
  const issuePanel=document.getElementById('mfa-existing-recovery-key');
  issuePanel.hidden=!missingRecovery || !document.getElementById('mfa-backup-key').hidden;
  document.getElementById('mfa-continue').hidden=
    !state.verified || missingRecovery || !document.getElementById('mfa-backup-key').hidden;
  document.getElementById('mfa-manage-link').hidden=missingRecovery ||
    !document.getElementById('mfa-backup-key').hidden;
  let approval={approved:false,requestId:null,expiresAt:null};
  if(firstTime && accountIsAdministrator){
    const ar=await fetch('/api/auth/mfa/enrollment/status',{credentials:'same-origin'});
    if(ar.ok)approval=await ar.json();
  }
  enrollmentApproved=!!approval.approved;
  enrollmentRequestId=approval.requestId||null;
  document.getElementById('mfa-approval-panel').hidden=!firstTime || !accountIsAdministrator;
  document.getElementById('mfa-self-enroll-form').hidden=!firstTime;
  document.getElementById('mfa-approval-admin').hidden=!state.canManageRecovery;
  document.getElementById('mfa-self-recovery').hidden=accountIsAdministrator || managingMethods;
  document.getElementById('mfa-approval-state').textContent=enrollmentApproved
    ? 'Approval is ready. You can enroll with your current password or use the approved recovery grant.'
    : enrollmentRequestId
      ? 'Awaiting two independent administrator approvals. Request ID: '+enrollmentRequestId
      : 'No second administrator is needed for first-time setup. Confirm your current password below.';
  document.getElementById('mfa-approval-request').disabled=!!enrollmentRequestId;
  document.getElementById('mfa-approval-check').hidden=!firstTime || !enrollmentRequestId;
  document.getElementById('recovery').hidden=!state.canManageRecovery;
  const manageBanner=document.getElementById('mfa-manage-banner');
  if(manageBanner)manageBanner.hidden=!(managingMethods && state.verified);
  document.getElementById('totp-panel').hidden=!state.totpAvailable;
  document.getElementById('totp-start').hidden=!!state.totpEnrolled;
  // Only show the next relevant action. The server remains authoritative.
  const passkeyVerify=document.getElementById('mfa-passkey-verify-panel');
  const passkeyEnroll=document.getElementById('mfa-passkey-enroll-panel');
  const passkeyActions=document.getElementById('mfa-passkey-actions');
  // On the protected method-manager page, an authenticator-verified
  // superadmin may explicitly step up with an existing passkey for sensitive
  // approvals without first logging out.
  if(passkeyVerify)passkeyVerify.hidden=!state.passkeyEnrolled ||
    (!!state.verified && (!managingMethods || state.verificationMethod==='PASSKEY'));
  // A user who already has authenticator MFA should not be asked for a new
  // passkey enrollment grant at every sign-in.
  if(passkeyEnroll)passkeyEnroll.hidden=managingMethods
    ? !state.verified
    : (!!state.verified || !!state.enrolled);
  if(passkeyActions)passkeyActions.hidden=
    (!!passkeyVerify?.hidden && !!passkeyEnroll?.hidden);
  const passkeyGrantLabel=document.querySelector?.('label[for="grant"]');
  grantEl.hidden=true;
  if(passkeyGrantLabel)passkeyGrantLabel.hidden=true;
  enrollBtn.disabled=false;
  document.getElementById('totp-grant').hidden=true;
  document.getElementById('totp-start').hidden=!!state.totpEnrolled || (!!state.verified && !managingMethods);
  document.getElementById('totp-start').disabled=false;
  document.getElementById('totp-title').textContent=state.totpEnrolled
    ? 'Verify with your authenticator app'
    : 'Set up your authenticator app with a QR code';
  const instructions=document.getElementById('totp-instructions');
  if(instructions)instructions.textContent=state.totpEnrolled
    ? 'Open the existing The Fixer entry in your authenticator app and enter its current six-digit code. Any app that supports standard TOTP works; you only scan a QR during initial setup.'
    : managingMethods && state.verified
      ? 'Add a second method: scan your one-time QR code and verify a six-digit code. Your verified session authorizes the change.'
      : 'First time only: confirm your current password, open any authenticator app that supports standard TOTP, add an account and scan your personal QR. Enter one code to activate it.';
  const totpGrantLabel=document.querySelector?.('label[for="totp-grant"]');
  if(totpGrantLabel)totpGrantLabel.hidden=true;
  document.getElementById('totp-panel').hidden=!state.totpAvailable || (!!state.verified && (!managingMethods || !!state.totpEnrolled));
  document.getElementById('totp-state').textContent=state.totpEnrolled
    ? 'Already set up. Enter the current six-digit code from your app. No setup key or QR scan is needed again.'
    : state.verified && managingMethods
      ? 'Your session is verified. Add an authenticator using a QR code without another enrollment grant.'
    : state.verified
      ? 'Your account is verified. No new setup is needed to continue.'
      : 'Confirm your current password, choose Generate QR code, and scan it with any authenticator app that supports standard TOTP. No second administrator is needed for first-time setup.';
  // The setup code was already consumed by confirmation. Never prompt the
  // user to verify it again on the same freshly elevated session.
  document.getElementById('totp-verify-panel').hidden=!state.totpEnrolled || !!state.verified;
  const success=document.getElementById('mfa-success');
  success.hidden=!state.verified;
  if(state.verified){
    document.getElementById('mfa-success-title').textContent=
      state.verificationMethod==='TOTP'?'Authenticator app connected and verified.':'Passkey verified successfully.';
    const keyStillVisible=!document.getElementById('mfa-backup-key').hidden;
    document.getElementById('mfa-success-note').textContent=
      keyStillVisible
        ? 'Save and acknowledge the recovery key shown below before continuing. You cannot view it again.'
        : missingRecovery
          ? 'MFA is verified. Generate and securely save your one-time recovery key before opening the dashboard.'
          : 'Your account MFA is active. On your next sign-in, use an enrolled passkey or a fresh authenticator code.';
  }
  if(state.totpEnrolled){
    document.getElementById('totp-setup').hidden=true;
    document.getElementById('totp-manual-key').textContent='';
    document.getElementById('totp-qr').removeAttribute('src');
  }
  show(state.verified?'MFA verified with '+(state.verificationMethod==='TOTP'?'authenticator app.':'passkey.')+' You may continue.':
   !state.enrolled?'MFA setup required. Confirm your current password, then choose a passkey or authenticator QR.':
   state.passkeyEnrolled&&state.totpEnrolled?'Verify your passkey or enter a six-digit authenticator code to continue.':
   state.totpEnrolled?'Authenticator app enrolled. Enter a fresh six-digit code — no enrollment grant is needed.':
   'Passkey enrolled. Verify it to continue to your account.');
 }catch(e){
  document.getElementById('recovery').hidden=true;
  show(e.message);
 }
}
async function run(kind){
 const button=kind==='enroll'?enrollBtn:verifyBtn;
 button.disabled=true;verifyBtn.disabled=true;enrollBtn.disabled=true;
 try{
  if(!browserSupported())throw Error('This browser does not support the required WebAuthn passkey APIs.');
  if(kind==='enroll'){
    const grantCode=grantEl.value.trim();
    const password=document.getElementById('mfa-enrollment-password').value;
    if(!managingMethods && !password && !legacyGrant)
      throw Error('Enter your current password before enrolling MFA.');
    const proof=grantCode?{grantCode}:{password};
    show('Waiting for passkey registration on your device…');
    const options=await api('register/options',proof);
    const publicKey=creationOptions(options);
    const credential=await navigator.credentials.create({publicKey});
    if(!credential)throw Error('Enrollment cancelled');
    const result=await api('register/verify',{challenge:options.challenge,response:serialize(credential),...proof});
    document.getElementById('mfa-enrollment-password').value='';
    displayRecoveryKey(result.recoveryKey);
    grantEl.value='';show('Passkey enrolled and verified. Your account is protected.');
  }else{
    show('Waiting for passkey confirmation…');
    const options=await api('authenticate/options');
    const publicKey=requestOptions(options);
    const credential=await navigator.credentials.get({publicKey});
    if(!credential)throw Error('Verification cancelled');
    await api('authenticate/verify',{challenge:options.challenge,response:serialize(credential)});
    show('Passkey verified. You can continue.');
  }
 }catch(error){show(error?.message||'Passkey verification failed.');}
 finally{button.disabled=false;verifyBtn.disabled=false;enrollBtn.disabled=false;await refresh();}
}
verifyBtn.addEventListener('click',()=>run('verify'));
enrollBtn.addEventListener('click',()=>run('enroll'));
refresh();

// The QR image is built privately by the server. Never use remote QR services,
// persist a provisioning secret in localStorage, or log a six-digit code.
const totpStart=document.getElementById('totp-start');
const totpConfirm=document.getElementById('totp-confirm');
const totpVerify=document.getElementById('totp-verify');
async function withTotpBusy(button,action){
 button.disabled=true;
 try{await action();}catch(error){show(error?.message||'Authenticator app request failed');}
 finally{button.disabled=false;}
}
totpStart.addEventListener('click',()=>withTotpBusy(totpStart,async()=>{
 const grantCode=document.getElementById('totp-grant').value.trim();
 const password=document.getElementById('mfa-enrollment-password').value;
 if(!managingMethods && !password && !legacyGrant)throw Error('Enter your current password before enrolling MFA.');
 show('Generating your private authenticator QR code…');
 const data=await api('totp/setup',grantCode?{grantCode}:{password});
 if(typeof data.qrDataUri!=='string'||!data.qrDataUri.startsWith('data:image/svg+xml;base64,'))
   throw Error('The QR code could not be generated');
 document.getElementById('totp-qr').src=data.qrDataUri;
 document.getElementById('totp-manual-key').textContent=data.manualKey||'';
 document.getElementById('totp-setup').hidden=false;
 show('Open any authenticator app that supports standard TOTP, add an account, scan this QR, and enter the six-digit code below.');
}));
totpConfirm.addEventListener('click',()=>withTotpBusy(totpConfirm,async()=>{
 const code=document.getElementById('totp-confirm-code').value.trim();
 if(!/^[0-9]{6}$/.test(code))throw Error('Enter the six-digit code shown in your authenticator app.');
 const password=document.getElementById('mfa-enrollment-password').value;
 const grantCode=document.getElementById('totp-grant').value.trim();
 const proof=grantCode?{grantCode}:{password};
 const result=await api('totp/confirm',{...proof,code});
 displayRecoveryKey(result.recoveryKey);
 document.getElementById('mfa-enrollment-password').value='';
 document.getElementById('totp-confirm-code').value='';
 document.getElementById('totp-manual-key').textContent='';
 document.getElementById('totp-qr').removeAttribute('src');
 document.getElementById('totp-setup').hidden=true;
 document.getElementById('totp-grant').value='';
 show('Authenticator app enrolled and verified. Your account is protected.');
 await refresh();
}));
totpVerify.addEventListener('click',()=>withTotpBusy(totpVerify,async()=>{
 const field=document.getElementById('totp-code');
 const code=field.value.trim();
 if(!/^[0-9]{6}$/.test(code))throw Error('Enter the current six-digit authenticator code.');
 await api('totp/verify',{code});
 field.value='';
 show('Authenticator app verified. Opening your dashboard…');
 if(!managingMethods){window.location.assign('/dashboard');return;}
 await refresh();
}));

async function recoveryApi(path,data){
 const response=await fetch('/api/admin/mfa/recovery/'+path,{
  method:'POST',credentials:'same-origin',
  headers:{'Content-Type':'application/json'},body:JSON.stringify(data),
 });
 const body=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(body.error||'Recovery approval rejected');
 return body;
}
async function withRecoveryBusy(button,operation){
 const output=document.getElementById('recovery-result');
 button.disabled=true;output.textContent='Verifying recovery approval…';
 try{await operation(output);}catch(error){output.textContent=error?.message||'Recovery operation rejected';}
 finally{button.disabled=false;}
}
const recoveryRequestButton=document.getElementById('recovery-request');
const recoveryApproveButton=document.getElementById('recovery-approve');
recoveryRequestButton.addEventListener('click',()=>withRecoveryBusy(recoveryRequestButton,async output=>{
 const targetUserId=document.getElementById('recovery-target').value.trim();
 if(!targetUserId || targetUserId.length>128)throw Error('Enter the affected administrator user ID');
 const result=await recoveryApi('request',{targetUserId});
 document.getElementById('recovery-request-id').value=result.requestId;
 output.textContent='Recovery request created.\nRequest ID: '+result.requestId+
  '\nExpires: '+result.expiresAt+
  '\nA different, passkey-verified superadministrator must independently approve it.';
}));
recoveryApproveButton.addEventListener('click',()=>withRecoveryBusy(recoveryApproveButton,async output=>{
 const id=document.getElementById('recovery-request-id').value.trim();
 if(!id || id.length>128)throw Error('Enter the pending recovery request ID');
 const result=await recoveryApi(encodeURIComponent(id)+'/approve',{});
 output.textContent='Recovery approved; existing credentials and sessions revoked.\n'+
  'One-time replacement grant (shown only in this response):\n'+result.grantCode+
  '\nExpires: '+result.expiresAt+
  '\nDeliver privately to the identity-verified administrator. Do not paste into tickets or chat.';
}));

document.getElementById('mfa-self-recovery-submit').addEventListener('click',async event=>{
 const button=event.currentTarget;
 const password=document.getElementById('mfa-recovery-password');
 const recoveryKey=document.getElementById('mfa-recovery-key');
 const output=document.getElementById('mfa-self-recovery-status');
 if(!password.value || !/^[A-Za-z0-9_-]{43}$/.test(recoveryKey.value)){
  output.textContent='Enter your current password and the 43-character recovery key.';
  return;
 }
 button.disabled=true;output.textContent='Verifying your recovery details…';
 try{
  await api('recovery/self',{password:password.value,recoveryKey:recoveryKey.value});
  password.value='';recoveryKey.value='';
  output.textContent='Your lost MFA methods and sessions were revoked. Sign in again to enroll a new method.';
  window.location.assign('/login');
 }catch(error){
  password.value='';recoveryKey.value='';
  output.textContent=error?.message||'Account recovery failed.';
 }finally{button.disabled=false;}
});


document.getElementById('mfa-approval-check').addEventListener('click',()=>refresh());
const approvalRequestButton=document.getElementById('mfa-approval-request');
approvalRequestButton.addEventListener('click',async()=>{
 if(!accountIsAdministrator){show('Use your current password to start account MFA setup.');return;}
 approvalRequestButton.disabled=true;
 try{
  const result=await api('enrollment/request');
  enrollmentRequestId=result.requestId;
  document.getElementById('mfa-approval-state').textContent=
    'Request sent. Share this ID with your security administrators for identity verification: '+result.requestId;
 }catch(error){show(error?.message||'Enrollment approval request failed');}
 finally{await refresh();}
});
document.getElementById('mfa-legacy-apply').addEventListener('click',async()=>{
 const value=document.getElementById('mfa-legacy-grant').value.trim();
 if(!/^[A-Za-z0-9_-]{43}$/.test(value)){show('A valid, approved recovery or bootstrap grant is required.');return;}
 legacyGrant=value;
 grantEl.value=value;
 document.getElementById('totp-grant').value=value;
 document.getElementById('mfa-legacy-grant').value='';
 show('Approved bootstrap or recovery grant applied for this enrollment only.');
 await refresh();
});
const approveEnrollment=document.getElementById('mfa-approval-approve');
approveEnrollment.addEventListener('click',async()=>{
 const target=document.getElementById('mfa-approval-id').value.trim();
 const checked=document.getElementById('mfa-approval-confirm-identity').checked;
 const resultEl=document.getElementById('mfa-approval-admin-status');
 if(!checked){resultEl.textContent='Confirm identity through a separate trusted channel first.';return;}
 if(!target || target.length>128){resultEl.textContent='Enter the enrollment request ID.';return;}
 approveEnrollment.disabled=true;
 try{
  const response=await fetch('/api/admin/mfa/enrollment/'+encodeURIComponent(target)+'/approve',{
   method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({identityConfirmed:true})
  });
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw Error(result.error||'Approval rejected');
  resultEl.textContent=result.approved
    ? 'Second independent approval recorded. The requester may now enroll MFA.'
    : 'First approval recorded. Another verified superadministrator must approve.';
  document.getElementById('mfa-approval-confirm-identity').checked=false;
 }catch(error){resultEl.textContent=error?.message||'Approval failed';}
 finally{approveEnrollment.disabled=false;}
});


document.getElementById('mfa-backup-copy').addEventListener('click',async()=>{
 const key=document.getElementById('mfa-backup-value').textContent;
 if(!key)return;
 try{await navigator.clipboard.writeText(key);show('Recovery key copied. Store it in a protected password manager, then clear your clipboard.');}
 catch{show('Clipboard unavailable. Copy the displayed key into your password manager manually.');}
});
document.getElementById('mfa-backup-confirm').addEventListener('change',()=>{
 document.getElementById('mfa-backup-dismiss').disabled=
  !document.getElementById('mfa-backup-confirm').checked;
});
document.getElementById('mfa-backup-dismiss').addEventListener('click',async()=>{
 document.getElementById('mfa-backup-value').textContent='';
 document.getElementById('mfa-backup-key').hidden=true;
 await refresh();
 show('Recovery key hidden. The Fixer cannot display it again.');
});

document.getElementById('mfa-existing-recovery-issue').addEventListener('click',async()=>{
 const button=document.getElementById('mfa-existing-recovery-issue');
 button.disabled=true;
 try{
  const response=await api('recovery-key/issue');
  displayRecoveryKey(response.recoveryKey);
  document.getElementById('mfa-existing-recovery-key').hidden=true;
  show('Save this account recovery key now. It cannot be displayed again.');
 }catch(error){show(error?.message||'Recovery key could not be issued.');}
 finally{button.disabled=false;}
});
