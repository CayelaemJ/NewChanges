'use strict';
const statusEl=document.getElementById('status');
const verifyBtn=document.getElementById('verify');
const enrollBtn=document.getElementById('enroll');
const grantEl=document.getElementById('grant');
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
  show(!state.configured?'Passkey verification is not configured on this environment.':
   state.verified?'Passkey verified for this session. Administrative changes are available.':
   state.enrolled?'A passkey is enrolled. Verify it to unlock administrator actions.':
   'No passkey is enrolled yet. Request a one-time enrollment grant.');
 }catch(e){show(e.message)}
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
    const publicKey=PublicKeyCredential.parseCreationOptionsFromJSON(options);
    const credential=await navigator.credentials.create({publicKey});
    if(!credential)throw Error('Enrollment cancelled');
    await api('register/verify',{challenge:options.challenge,response:serialize(credential),grantCode});
    grantEl.value='';show('Passkey enrolled and verified. You can return to the admin console.');
  }else{
    show('Waiting for passkey confirmation…');
    const options=await api('authenticate/options');
    const publicKey=PublicKeyCredential.parseRequestOptionsFromJSON(options);
    const credential=await navigator.credentials.get({publicKey});
    if(!credential)throw Error('Verification cancelled');
    await api('authenticate/verify',{challenge:options.challenge,response:serialize(credential)});
    show('Passkey verified. You can return to the admin console.');
  }
 }catch(error){show(error?.message||'Passkey verification failed.');}
 finally{button.disabled=false;verifyBtn.disabled=false;enrollBtn.disabled=false;}
}
verifyBtn.addEventListener('click',()=>run('verify'));
enrollBtn.addEventListener('click',()=>run('enroll'));
refresh();
