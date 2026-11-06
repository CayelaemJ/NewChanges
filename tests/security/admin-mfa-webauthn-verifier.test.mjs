import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAdminPasskeyAssertion} from '../../src/services/adminMfaWebAuthnVerifier.mjs';
import {newMfaChallenge} from '../../src/services/adminMfaChallenge.mjs';
const challenge=newMfaChallenge().challenge;
const base={challenge,origin:'https://admin.example.com',rpID:'example.com',
 response:{id:'credential-A',type:'public-key'},credential:{id:'credential-A',publicKey:'AQID',counter:0}};
test('rejects invalid verification input without elevating a session',async()=>{
 for(const patch of [
 {challenge:'invalid'}, {origin:'http://admin.example.com'},
 {origin:'https://evil.example.org'}, {rpID:'example.org'},
 {response:{id:'credential-B'}}, {credential:{...base.credential,counter:-1}},
 {credential:null},
 ]) assert.equal(await verifyAdminPasskeyAssertion({...base,...patch}),null);
});
test('unsigned synthetic assertion never passes cryptographic verification',async()=>{
 assert.equal(await verifyAdminPasskeyAssertion(base),null);
});
