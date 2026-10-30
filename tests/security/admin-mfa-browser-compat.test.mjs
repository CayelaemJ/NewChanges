import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createContext,runInContext} from 'node:vm';

function loadPage(){
 const elements=new Map();
 const document={getElementById(id){
  if(!elements.has(id))elements.set(id,{textContent:'',disabled:false,value:'',addEventListener(){}});
  return elements.get(id);
 }};
 const context=createContext({
  document,window:{isSecureContext:true},navigator:{credentials:{}},
  PublicKeyCredential:function PublicKeyCredential(){},
  fetch:async()=>({ok:true,json:async()=>({configured:true,enrolled:true,verified:false})}),
  Uint8Array,atob,btoa,Error,JSON,
 });
 runInContext(readFileSync('public/admin-mfa.js','utf8'),context);
 return context;
}
test('native WebAuthn fallback supports iOS/Safari without JSON helper methods',()=>{
 const context=loadPage();
 assert.equal(runInContext('browserSupported()',context),true);
 const req=runInContext("requestOptions({challenge:'AQID',allowCredentials:[{id:'BAUG',type:'public-key'}]})",context);
 assert.deepEqual(Array.from(req.challenge),[1,2,3]);
 assert.deepEqual(Array.from(req.allowCredentials[0].id),[4,5,6]);
 const reg=runInContext("creationOptions({challenge:'AQID',user:{id:'BAUG',name:'u',displayName:'u'},excludeCredentials:[]})",context);
 assert.deepEqual(Array.from(reg.user.id),[4,5,6]);
});
test('attestation and assertion responses are serialized without credential.toJSON',()=>{
 const ctx=loadPage();
 const created=runInContext("serialize({id:'cred',type:'public-key',rawId:new Uint8Array([1,2,3]),response:{clientDataJSON:new Uint8Array([4,5]),attestationObject:new Uint8Array([6,7]),getTransports(){return ['internal']}},getClientExtensionResults(){return {}}})",ctx);
 assert.equal(created.rawId,'AQID');
 assert.equal(created.response.attestationObject,'Bgc');
 const signed=runInContext("serialize({id:'cred',type:'public-key',rawId:new Uint8Array([1]),response:{clientDataJSON:new Uint8Array([2]),authenticatorData:new Uint8Array([3]),signature:new Uint8Array([4]),userHandle:null}})",ctx);
 assert.equal(signed.response.signature,'BA');
 assert.equal(signed.response.userHandle,null);
});
test('malformed base64url and incomplete passkey assertions are rejected',()=>{
 const ctx=loadPage();
 assert.throws(()=>runInContext("fromBase64Url('not valid!')",ctx));
 assert.throws(()=>runInContext("serialize({type:'public-key',response:{clientDataJSON:new Uint8Array([1])}})",ctx));
});
