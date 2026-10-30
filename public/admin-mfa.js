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
 return typeof PublicKeyCredential!=='undefined' &&
  typeof PublicKeyCredential.parseCreationOptionsFromJSON==='function' &&
  typeof PublicKeyCredential.parseRequestOptionsFromJSON==='function' &&
  !!navigator.credentials;
}
function serialize(credential){
 if(typeof credential?.toJSON==='function')return credential.toJSON();
 throw Error('Your browser needs an update to support passkeys safely');
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
