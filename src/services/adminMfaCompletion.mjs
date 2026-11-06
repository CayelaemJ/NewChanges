import { hashChallenge } from './adminMfaChallenge.mjs';

// Internal-only completion step. The caller MUST first verify the full WebAuthn
// assertion with a trusted cryptographic verifier (origin, rpID, signature,
// user verification, credential ownership and authenticator counter).
// Never expose this function directly as a route or pass request-body 'verified' flags.
export async function completeVerifiedAdminMfa(db, {
  challenge, userId, sessionId, credentialId, previousCounter, newCounter,
  verifiedByTrustedWebAuthnLibrary, now = new Date(),
}) {
  if (verifiedByTrustedWebAuthnLibrary !== true || !db?.$transaction ||
      !userId || !sessionId || !credentialId ||
      !Number.isSafeInteger(previousCounter) || previousCounter < 0 ||
      !Number.isSafeInteger(newCounter) || newCounter < 0 ||
      !(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
  // Authenticators that always use zero counters are permitted by WebAuthn.
  // Otherwise counters must increase strictly.
  if (!(previousCounter === 0 && newCounter === 0) && newCounter <= previousCounter) return false;
  let challengeHash;
  try { challengeHash = hashChallenge(challenge); } catch { return false; }

  // All three writes commit together or are rolled back. This guards against
  // concurrent challenge replay, revoked credentials and session invalidation.
  try {
    return await db.$transaction(async tx => {
      const consumed = await tx.adminMfaChallenge.updateMany({
        where: {
          challengeHash, userId, sessionId, purpose:'authenticate',
          consumedAt:null, expiresAt:{gt:now},
          session:{userId,endedAt:null,revokedAt:null,expiresAt:{gt:now}},
        },
        data:{consumedAt:now},
      });
      if (consumed.count !== 1) throw new Error('MFA challenge unavailable');

      const credential = await tx.adminMfaCredential.updateMany({
        where:{
          credentialId,userId,revokedAt:null,
          signCount:BigInt(previousCounter),
        },
        data:{signCount:BigInt(newCounter),lastUsedAt:now},
      });
      if (credential.count !== 1) throw new Error('MFA credential changed');

      const session = await tx.session.updateMany({
        where:{id:sessionId,userId,endedAt:null,revokedAt:null,expiresAt:{gt:now}},
        data:{mfaVerifiedAt:now},
      });
      if (session.count !== 1) throw new Error('MFA session ended');
      return true;
    });
  } catch {
    return false;
  }
}
