import {verifyAdminPasskeyAssertion} from './adminMfaWebAuthnVerifier.mjs';
import {completeVerifiedAdminMfa} from './adminMfaCompletion.mjs';
import {matchesMfaChallenge} from './adminMfaChallenge.mjs';

// Server-side coordinator. Never accept a "verified" boolean from an HTTP
// payload. The cryptographic WebAuthn verifier is the only trust source.
// Until @simplewebauthn/server is installed and signed assertions pass,
// this routine deliberately refuses all authentication attempts.
export async function authenticateAdminPasskey({
  db, user, session, challengeRecord, challenge, response,
  credential, origin, rpID, now = new Date(),
}) {
  if (!db || !user || !session || !credential ||
      !['ADMIN','SUPERADMIN'].includes(user.role) || user.active !== true ||
      credential.userId !== user.id || credential.revokedAt ||
      session.userId !== user.id || session.endedAt || session.revokedAt ||
      new Date(session.expiresAt).getTime() <= now.getTime()) return false;
  if (!matchesMfaChallenge({
    provided:challenge,storedHash:challengeRecord?.challengeHash,
    userId:user.id,sessionId:session.id,purpose:'authenticate',
    record:challengeRecord,now:now.getTime(),
  })) return false;
  const proof=await verifyAdminPasskeyAssertion({response,challenge,origin,rpID,
    credential:{id:credential.credentialId,publicKey:credential.publicKey,
      counter:Number(credential.signCount),transports:credential.transports}});
  if (!proof) return false;
  return completeVerifiedAdminMfa(db,{
    challenge,userId:user.id,sessionId:session.id,
    credentialId:proof.credentialId,previousCounter:proof.previousCounter,
    newCounter:proof.newCounter,verifiedByTrustedWebAuthnLibrary:true,now,
  });
}
