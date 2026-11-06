import test from 'node:test';
import assert from 'node:assert/strict';
import {adminMfaGate,recoveryRequirements,ADMIN_MFA_ENFORCEMENT_READY} from '../../src/services/adminMfaRollout.mjs';
const now=1800000000000;
const user={id:'u1',role:'ADMIN',active:true};
const session={userId:'u1',expiresAt:new Date(now+600000),mfaVerifiedAt:new Date(now-1000),endedAt:null,revokedAt:null};
test('enforcement remains disabled pending complete verified passkey flows',()=>{
 assert.equal(ADMIN_MFA_ENFORCEMENT_READY,false);
});
test('authorization gate permits valid, fresh, session-bound verified administrator',()=>{
 assert.equal(adminMfaGate({user,session,now}).allowed,true);
});
test('authorization gate denies absent, stale, mismatched, invalid and revoked verification',()=>{
 for(const patch of [
 {session:{...session,mfaVerifiedAt:null}},
 {session:{...session,mfaVerifiedAt:new Date(now-600001)}},
 {session:{...session,userId:'u2'}},
 {session:{...session,endedAt:new Date()}},
 {session:{...session,revokedAt:new Date()}},
 {session:{...session,expiresAt:new Date(now-1)}},
 {user:{...user,role:'VIEWER'}},
 {user:{...user,active:false}},
 ]) assert.equal(adminMfaGate({user,session,now,...patch}).allowed,false);
});
test('recovery requires independent checks, dual approval, audit, revocation and replacement',()=>{
 const proof={independentIdentityCheck:true,twoPersonApproval:true,auditRecorded:true,allSessionsRevoked:true,credentialsReplaced:true};
 assert.equal(recoveryRequirements(proof),true);
 for(const key of Object.keys(proof)) assert.equal(recoveryRequirements({...proof,[key]:false}),false);
});
