'use strict';
const statusEl=document.getElementById('status');
const verifyBtn=document.getElementById('verify');
const enrollBtn=document.getElementById('enroll');
const grantEl=document.getElementById('grant');
const managingMethods=window.location?.pathname==='/mfa/manage';
function show(message){statusEl.textContent=message;}
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
  if(!res.ok)throw Error('Please sign in as an administrator');
  const state=await res.json();
  document.getElementById('recovery').hidden=!state.canManageRecovery;
  const manageBanner=document.getElementById('mfa-manage-banner');
  if(manageBanner)manageBanner.hidden=!(managingMethods && state.verified);
  document.getElementById('totp-panel').hidden=!state.totpAvailable;
  document.getElementById('totp-start').hidden=!!state.totpEnrolled;
  // Only show the next relevant action. The server remains authoritative.
  const passkeyVerify=document.getElementById('mfa-passkey-verify-panel');
  const passkeyEnroll=document.getElementById('mfa-passkey-enroll-panel');
  const passkeyActions=document.getElementById('mfa-passkey-actions');
  if(passkeyVerify)passkeyVerify.hidden=!!state.verified || !state.passkeyEnrolled;
  // A user who already has authenticator MFA should not be asked for a new
  // passkey enrollment grant at every sign-in.
  if(passkeyEnroll)passkeyEnroll.hidden=managingMethods
    ? !state.verified
    : (!!state.verified || !!state.enrolled);
  if(passkeyActions)passkeyActions.hidden=
    (!!passkeyVerify?.hidden && !!passkeyEnroll?.hidden);
  document.getElementById('totp-grant').hidden=!!state.totpEnrolled || !!state.verified || managingMethods;
  document.getElementById('totp-start').hidden=!!state.totpEnrolled || (!!state.verified && !managingMethods);
  document.getElementById('totp-title').textContent=state.totpEnrolled
    ? 'Verify with your authenticator app'
    : 'Set up your authenticator app with a QR code';
  const instructions=document.getElementById('totp-instructions');
  if(instructions)instructions.textContent=state.totpEnrolled
    ? 'Open the existing The Fixer entry in Google or Microsoft Authenticator and enter its current six-digit code. You only scan a QR during initial setup.'
    : 'First time only: request your personal QR code, open Google Authenticator or Microsoft Authenticator, tap Add account and scan the QR. Enter one code to activate the saved account.';
  const totpGrantLabel=document.querySelector?.('label[for="totp-grant"]');
  if(totpGrantLabel)totpGrantLabel.hidden=!!state.totpEnrolled || !!state.verified || managingMethods;
  document.getElementById('totp-panel').hidden=!state.totpAvailable || (!!state.verified && (!managingMethods || !!state.totpEnrolled));
  document.getElementById('totp-state').textContent=state.totpEnrolled
    ? 'Already set up. Enter the current six-digit code from your app. No setup key or QR scan is needed again.'
    : state.verified && managingMethods
      ? 'Your session is verified. Add an authenticator using a QR code without another enrollment grant.'
    : state.verified
      ? 'Your account is verified. No new setup is needed to continue.'
      : 'First-time setup only: enter your approved one-time enrollment grant, choose Show QR code, then scan it in Google or Microsoft Authenticator.';
  // The setup code was already consumed by confirmation. Never prompt the
  // user to verify it again on the same freshly elevated session.
  document.getElementById('totp-verify-panel').hidden=!state.totpEnrolled || !!state.verified;
  const success=document.getElementById('mfa-success');
  success.hidden=!state.verified;
  if(state.verified){
    document.getElementById('mfa-success-title').textContent=
      state.verificationMethod==='TOTP'?'Authenticator app connected and verified.':'Passkey verified successfully.';
    document.getElementById('mfa-success-note').textContent=
      'Your administrator MFA is active for this session. Continue to the dashboard. On your next sign-in, enter a NEW six-digit code from your authenticator app or use your enrolled passkey.';
  }
  if(state.totpEnrolled){
    document.getElementById('totp-setup').hidden=true;
    document.getElementById('totp-manual-key').textContent='';
    document.getElementById('totp-qr').removeAttribute('src');
  }
  show(state.verified?'Administrator MFA verified with '+(state.verificationMethod==='TOTP'?'authenticator app.':'passkey.')+' You may open the dashboard.':
   !state.enrolled?'MFA setup is required. Enroll a passkey or scan the QR code with an authenticator app using your approved grant.':
   state.passkeyEnrolled&&state.totpEnrolled?'Verify your passkey or enter a six-digit authenticator code to continue.':
   state.totpEnrolled?'Authenticator app enrolled. Enter a fresh six-digit code — no enrollment grant is needed.':
   'Passkey enrolled. Verify it to unlock administrator actions.');
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
    show('Waiting for passkey registration on your device…');
    const options=await api('register/options',{grantCode});
    const publicKey=creationOptions(options);
    const credential=await navigator.credentials.create({publicKey});
    if(!credential)throw Error('Enrollment cancelled');
    await api('register/verify',{challenge:options.challenge,response:serialize(credential),grantCode});
    grantEl.value='';show('Passkey enrolled and verified. You can return to the admin console.');
  }else{
    show('Waiting for passkey confirmation…');
    const options=await api('authenticate/options');
    const publicKey=requestOptions(options);
    const credential=await navigator.credentials.get({publicKey});
    if(!credential)throw Error('Verification cancelled');
    await api('authenticate/verify',{challenge:options.challenge,response:serialize(credential)});
    show('Passkey verified. You can return to the admin console.');
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
 if(!grantCode && !managingMethods)throw Error('Enter your approved one-time MFA setup grant first.');
 show('Generating your private authenticator QR code…');
 const data=await api('totp/setup',{grantCode});
 if(typeof data.qrDataUri!=='string'||!data.qrDataUri.startsWith('data:image/svg+xml;base64,'))
   throw Error('The QR code could not be generated');
 document.getElementById('totp-qr').src=data.qrDataUri;
 document.getElementById('totp-manual-key').textContent=data.manualKey||'';
 document.getElementById('totp-setup').hidden=false;
 show('Open Google or Microsoft Authenticator, add an account, scan this QR, and enter the six-digit code below.');
}));
totpConfirm.addEventListener('click',()=>withTotpBusy(totpConfirm,async()=>{
 const code=document.getElementById('totp-confirm-code').value.trim();
 if(!/^[0-9]{6}$/.test(code))throw Error('Enter the six-digit code shown in your authenticator app.');
 await api('totp/confirm',{grantCode:document.getElementById('totp-grant').value.trim(),code});
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
 show('Authenticator app verified. Administrator access granted.');
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
