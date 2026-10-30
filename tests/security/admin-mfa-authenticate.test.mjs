import test from 'node:test';
import assert from 'node:assert/strict';
import {newMfaChallenge} from '../../src/services/adminMfaChallenge.mjs';
import {authenticateAdminPasskey} from '../../src/services/adminMfaAuthenticate.mjs';
const now=new Date('2026-10-30T10:00:00Z');
const challenge=newMfaChallenge(now.getTime());
const base={
 db:{$transaction:async()=>{throw new Error('unexpected DB write');}},
 user:{id:'u1',role:'ADMIN',active:true},
 session:{id:'s1',userId:'u1',expiresAt:new Date(now.getTime()+600000),endedAt:null,revokedAt:null},
 challengeRecord:{challengeHash:challenge.challengeHash,userId:'u1',sessionId:'s1',
  purpose:'authenticate',expiresAt:challenge.expiresAt,consumedAt:null},
 challenge:challenge.challenge,
 response:{id:'cred1',type:'public-key'},
 credential:{credentialId:'cred1',userId:'u1',publicKey:'AQID',signCount:0n,transports:[],revokedAt:null},
 origin:'https://admin.example.com',rpID:'example.com',now,
};
test('cannot elevate a session with unsigned browser assertions',async()=>{
 assert.equal(await authenticateAdminPasskey(base),false);
});
test('cannot elevate a different user or session',async()=>{
 assert.equal(await authenticateAdminPasskey({...base,user:{...base.user,id:'u2'}}),false);
 assert.equal(await authenticateAdminPasskey({...base,session:{...base.session,id:'s2'}}),false);
});
test('cannot elevate a revoked credential or expired challenge',async()=>{
 assert.equal(await authenticateAdminPasskey({...base,credential:{...base.credential,revokedAt:now}}),false);
 assert.equal(await authenticateAdminPasskey({...base,challengeRecord:{...base.challengeRecord,expiresAt:now}}),false);
});
test('rejects non-admin accounts and incomplete challenges',async()=>{
 assert.equal(await authenticateAdminPasskey({...base,user:{...base.user,role:'VIEWER'}}),false);
 assert.equal(await authenticateAdminPasskey({...base,challenge:'bad'}),false);
});
