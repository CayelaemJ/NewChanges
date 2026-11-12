import test from 'node:test';
import assert from 'node:assert/strict';
import {newMfaChallenge,matchesMfaChallenge,CHALLENGE_TTL_MS} from '../../src/services/adminMfaChallenge.mjs';
const now=1800000000000;
test('randomized, hashed, five-minute challenges',()=>{
 const a=newMfaChallenge(now),b=newMfaChallenge(now);
 assert.notEqual(a.challenge,b.challenge);
 assert.notEqual(a.challenge,a.challengeHash);
 assert.equal(a.challengeHash.length,64);
 assert.equal(a.expiresAt.getTime(),now+CHALLENGE_TTL_MS);
});
test('rejects replay, wrong user, session, purpose, expiration, invalid values',()=>{
 const v=newMfaChallenge(now);
 const record={userId:'u1',sessionId:'s1',purpose:'authenticate',expiresAt:v.expiresAt,consumedAt:null};
 const base={provided:v.challenge,storedHash:v.challengeHash,userId:'u1',sessionId:'s1',purpose:'authenticate',record,now:now+1000};
 assert.equal(matchesMfaChallenge(base),true);
 for(const patch of [
 {provided:'not-valid'}, {userId:'u2'}, {sessionId:'s2'},
 {purpose:'register'}, {now:now+CHALLENGE_TTL_MS},
 {record:{...record,consumedAt:new Date(now)}},
 {storedHash:'bad'},{record:null},
 ]) assert.equal(matchesMfaChallenge({...base,...patch}),false);
});
