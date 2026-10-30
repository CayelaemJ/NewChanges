import test from 'node:test';
import assert from 'node:assert/strict';
import {newMfaChallenge} from '../../src/services/adminMfaChallenge.mjs';
import {consumeVerifiedMfaChallenge} from '../../src/services/adminMfaConsume.mjs';

test('atomic challenge consumption binds user, session, purpose and expiry',async()=>{
 const {challenge,challengeHash}=newMfaChallenge();
 const now=new Date();
 const calls=[];
 const db={adminMfaChallenge:{updateMany:async x=>{calls.push(x);return {count:1};}}};
 const ok=await consumeVerifiedMfaChallenge(db,{challenge,userId:'u',sessionId:'s',purpose:'authenticate',now});
 assert.equal(ok,true);
 assert.deepEqual(calls[0],{
  where:{challengeHash,userId:'u',sessionId:'s',purpose:'authenticate',
   consumedAt:null,expiresAt:{gt:now},
   session:{userId:'u',endedAt:null,revokedAt:null,expiresAt:{gt:now}}},
  data:{consumedAt:now}
 });
});
test('replay loses atomic conditional update race',async()=>{
 const {challenge}=newMfaChallenge();
 let consumed=false;
 const db={adminMfaChallenge:{updateMany:async()=>{if(consumed)return {count:0};consumed=true;return {count:1};}}};
 const req={challenge,userId:'u',sessionId:'s',purpose:'register'};
 assert.equal(await consumeVerifiedMfaChallenge(db,req),true);
 assert.equal(await consumeVerifiedMfaChallenge(db,req),false);
});
test('invalid inputs fail closed and never query database',async()=>{
 let calls=0;
 const db={adminMfaChallenge:{updateMany:async()=>{calls++;return {count:1};}}};
 for(const patch of [{challenge:'bad',userId:'u',sessionId:'s',purpose:'register'},
 {challenge:newMfaChallenge().challenge,userId:'',sessionId:'s',purpose:'register'},
 {challenge:newMfaChallenge().challenge,userId:'u',sessionId:'s',purpose:'not-supported'},
 {challenge:newMfaChallenge().challenge,userId:'u',sessionId:'s',purpose:'register',now:new Date(NaN)}]){
 assert.equal(await consumeVerifiedMfaChallenge(db,patch),false);
 }
 assert.equal(calls,0);
});
