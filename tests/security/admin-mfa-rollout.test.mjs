import test from 'node:test';
import assert from 'node:assert/strict';
import {accountMfaGate,recoveryRequirements,ALL_ACCOUNT_MFA_ENFORCEMENT_READY} from '../../src/services/adminMfaRollout.mjs';
const now=1800000000000;
const user={id:'u1',role:'ADMIN',active:true};
const session={userId:'u1',expiresAt:new Date(now+600000),mfaVerifiedAt:new Date(now-1000),endedAt:null,revokedAt:null};
test('production rollout remains gated pending complete all-account MFA acceptance',()=>{
 assert.equal(ALL_ACCOUNT_MFA_ENFORCEMENT_READY,false);
});
test('authorization gate permits a valid, fresh, session-bound factor for every role',()=>{
 for(const role of ['ADMIN','SUPERADMIN','EMPLOYER_MANAGER','PORTFOLIO_MANAGER','VIEWER'])
  assert.equal(accountMfaGate({user:{...user,role},session,now}).allowed,true,role);
});
test('authorization gate denies absent, stale, mismatched, invalid, revoked or inactive sessions',()=>{
 for(const patch of [
 {session:{...session,mfaVerifiedAt:null}},
 {session:{...session,mfaVerifiedAt:new Date(now-600001)}},
 {session:{...session,userId:'u2'}},
 {session:{...session,endedAt:new Date()}},
 {session:{...session,revokedAt:new Date()}},
 {session:{...session,expiresAt:new Date(now-1)}},
 {user:{...user,active:false}},
 ]) for(const role of ['ADMIN','SUPERADMIN','EMPLOYER_MANAGER','PORTFOLIO_MANAGER','VIEWER'])
  assert.equal(accountMfaGate({user:{...user,role},session,now,...patch}).allowed,false,role);
});
test('recovery requires independent checks, dual approval, audit, revocation and replacement',()=>{
 const proof={independentIdentityCheck:true,twoPersonApproval:true,auditRecorded:true,allSessionsRevoked:true,credentialsReplaced:true};
 assert.equal(recoveryRequirements(proof),true);
 for(const key of Object.keys(proof)) assert.equal(recoveryRequirements({...proof,[key]:false}),false);
});
