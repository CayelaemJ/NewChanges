import test from 'node:test';
import assert from 'node:assert/strict';
import {completeVerifiedAdminMfa} from '../../src/services/adminMfaCompletion.mjs';
import {newMfaChallenge} from '../../src/services/adminMfaChallenge.mjs';
const now = new Date();
const input={challenge:newMfaChallenge().challenge,userId:'u',sessionId:'s',credentialId:'c',previousCounter:1,newCounter:2,verifiedByTrustedWebAuthnLibrary:true,now};
function mock(counts=[1,1,1]){
 let calls=0;
 const tx={
 adminMfaChallenge:{updateMany:async()=>({count:counts[calls++]})},
 adminMfaCredential:{updateMany:async()=>({count:counts[calls++]})},
 session:{updateMany:async()=>({count:counts[calls++]})}};
 return {$transaction:fn=>fn(tx)};
}
test('does not advance MFA without trusted verification',async()=>{
 assert.equal(await completeVerifiedAdminMfa(mock(),{...input,verifiedByTrustedWebAuthnLibrary:false}),false);
});
test('completes verified challenge, credential and session updates',async()=>{
 assert.equal(await completeVerifiedAdminMfa(mock(),input),true);
});
test('rejects challenge replay',async()=>{
 assert.equal(await completeVerifiedAdminMfa(mock([0,1,1]),input),false);
});
test('rejects revoked credential',async()=>{
 assert.equal(await completeVerifiedAdminMfa(mock([1,0,1]),input),false);
});
test('rejects ended session',async()=>{
 assert.equal(await completeVerifiedAdminMfa(mock([1,1,0]),input),false);
});
test('rejects nonincreasing signature counter',async()=>{
 assert.equal(await completeVerifiedAdminMfa(mock(),{...input,newCounter:1}),false);
});
