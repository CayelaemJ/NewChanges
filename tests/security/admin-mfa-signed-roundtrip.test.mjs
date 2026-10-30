import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync,randomBytes,sign} from 'node:crypto';
import {generateRegistrationOptions,verifyRegistrationResponse,generateAuthenticationOptions,verifyAuthenticationResponse} from '@simplewebauthn/server';

// Synthetic, in-memory WebAuthn authenticator: no hardware, cloud, keys or credentials.
const b64 = b => Buffer.from(b).toString('base64url');
const hash = b => createHash('sha256').update(b).digest();
function major(type,n) {
 if(n<24)return Buffer.from([(type<<5)|n]);
 if(n<256)return Buffer.from([(type<<5)|24,n]);
 if(n<65536){const b=Buffer.alloc(3);b[0]=(type<<5)|25;b.writeUInt16BE(n,1);return b;}
 throw new Error('Unexpected synthetic CBOR length');
}
function cbor(v) {
 if(typeof v==='number')return v>=0?major(0,v):major(1,-1-v);
 if(typeof v==='string'){const b=Buffer.from(v);return Buffer.concat([major(3,b.length),b]);}
 if(Buffer.isBuffer(v)||v instanceof Uint8Array){const b=Buffer.from(v);return Buffer.concat([major(2,b.length),b]);}
 if(v instanceof Map)return Buffer.concat([major(5,v.size),...Array.from(v).flatMap(([k,x])=>[cbor(k),cbor(x)])]);
 throw new Error('Unsupported synthetic CBOR field');
}
function clientData(type,challenge,origin){
 return Buffer.from(JSON.stringify({type,challenge,origin,crossOrigin:false}));
}
test('register and authenticate a signed synthetic administrator passkey',async()=>{
 const rpID='localhost',origin='http://localhost:3000',credentialID=randomBytes(32);
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const jwk=publicKey.export({format:'jwk'});
 const cose=cbor(new Map([[1,2],[3,-7],[-1,1],[-2,Buffer.from(jwk.x,'base64url')],[-3,Buffer.from(jwk.y,'base64url')]]));
 const registration=await generateRegistrationOptions({
  rpName:'The Fixer',rpID,userID:new Uint8Array(Buffer.from('synthetic-admin')),
  userName:'admin@example.invalid',attestationType:'none',supportedAlgorithmIDs:[-7],
  authenticatorSelection:{residentKey:'preferred',userVerification:'required'},
 });
 const credLen=Buffer.alloc(2);credLen.writeUInt16BE(credentialID.length);
 const authenticatorData=Buffer.concat([
  hash(rpID),Buffer.from([0x45]),Buffer.alloc(4),Buffer.alloc(16),credLen,credentialID,cose,
 ]);
 const attestation=cbor(new Map([['fmt','none'],['attStmt',new Map()],['authData',authenticatorData]]));
 const regResponse={
  id:b64(credentialID),rawId:b64(credentialID),type:'public-key',
  response:{clientDataJSON:b64(clientData('webauthn.create',registration.challenge,origin)),
    attestationObject:b64(attestation),transports:['internal']},
  clientExtensionResults:{},
 };
 const registered=await verifyRegistrationResponse({
  response:regResponse,expectedChallenge:registration.challenge,
  expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,supportedAlgorithmIDs:[-7],
 });
 assert.equal(registered.verified,true);
 assert.ok(registered.registrationInfo?.credential.publicKey);
 const auth=await generateAuthenticationOptions({
   rpID,userVerification:'required',allowCredentials:[{id:b64(credentialID)}],
 });
 const authData=Buffer.concat([hash(rpID),Buffer.from([0x05]),Buffer.from([0,0,0,1])]);
 const authClientData=clientData('webauthn.get',auth.challenge,origin);
 const signature=sign('sha256',Buffer.concat([authData,hash(authClientData)]),privateKey);
 const authResponse={
  id:b64(credentialID),rawId:b64(credentialID),type:'public-key',
  response:{clientDataJSON:b64(authClientData),authenticatorData:b64(authData),
    signature:b64(signature),userHandle:null},
  clientExtensionResults:{},
 };
 const result=await verifyAuthenticationResponse({
  response:authResponse,expectedChallenge:auth.challenge,
  expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,
  credential:{id:b64(credentialID),
    publicKey:registered.registrationInfo.credential.publicKey,counter:0,transports:['internal']},
 });
 assert.equal(result.verified,true);
 assert.equal(result.authenticationInfo?.newCounter,1);
});
