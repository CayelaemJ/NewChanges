import test from 'node:test';
import assert from 'node:assert/strict';
import { canPerformPrivilegedAction, ADMIN_MFA_MAX_AGE_MS } from '../../src/services/adminMfaPolicy.mjs';
const now=1_800_000_000_000;
const valid={
 role:'ADMIN',active:true,sessionId:'session-a',sessionEndedAt:null,sessionRevokedAt:null,
 proofSessionId:'session-a',proofUserId:'user-a',userId:'user-a',
 verifiedAt:now-1000,now
};
test('allows recent session-bound verification for an administrator',()=>{
 assert.equal(canPerformPrivilegedAction(valid),true);
 assert.equal(canPerformPrivilegedAction({...valid,role:'SUPERADMIN'}),true);
});
for(const [title,patch] of [
 ['non-admin role',{role:'VIEWER'}],['inactive account',{active:false}],
 ['missing MFA proof',{verifiedAt:null}],['expired MFA proof',{verifiedAt:now-ADMIN_MFA_MAX_AGE_MS-1}],
 ['future MFA proof',{verifiedAt:now+1}],['other session',{proofSessionId:'session-b'}],
 ['other user',{proofUserId:'user-b'}],['revoked session',{sessionRevokedAt:now-1}],
 ['ended session',{sessionEndedAt:now-1}],['empty session',{sessionId:''}],
 ['NaN verification',{verifiedAt:NaN}]
]) test('denies '+title,()=>assert.equal(canPerformPrivilegedAction({...valid,...patch}),false));
