import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
export const CHALLENGE_TTL_MS=5*60*1000;
export function newMfaChallenge(now=Date.now()){
 const challenge=randomBytes(32).toString('base64url');
 return {challenge,challengeHash:hashChallenge(challenge),expiresAt:new Date(now+CHALLENGE_TTL_MS)};
}
export function hashChallenge(value){
 if(typeof value!=='string'||! /^[A-Za-z0-9_-]{43}$/.test(value)) throw new Error('Invalid challenge format');
 return createHash('sha256').update(value).digest('hex');
}
// Validation only. Callers must atomically consume the DB row after independently
// verifying WebAuthn origin, RP ID, signature, credential ownership and counter.
export function matchesMfaChallenge({provided,storedHash,userId,sessionId,purpose,record,now=Date.now()}){
 if(!record||!userId||!sessionId||!purpose||record.userId!==userId||
 record.sessionId!==sessionId||record.purpose!==purpose||record.consumedAt) return false;
 const expiry=new Date(record.expiresAt).getTime();
 if(!Number.isFinite(expiry)||now>=expiry) return false;
 try {
  const a=Buffer.from(hashChallenge(provided),'hex'),b=Buffer.from(storedHash,'hex');
  return a.length===b.length&&timingSafeEqual(a,b);
 } catch {return false;}
}
