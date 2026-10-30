import {hashChallenge} from './adminMfaChallenge.mjs';

// Consume a challenge exactly once with a conditional database update.
// Must be called only AFTER complete WebAuthn cryptographic verification.
// Never use this routine as proof of WebAuthn authentication on its own.
export async function consumeVerifiedMfaChallenge(db, {
  challenge, userId, sessionId, purpose, now = new Date(),
}) {
  if (!db?.adminMfaChallenge?.updateMany || !userId || !sessionId ||
      !['register', 'authenticate'].includes(purpose) ||
      !(now instanceof Date) || !Number.isFinite(now.getTime())) return false;
  let challengeHash;
  try { challengeHash = hashChallenge(challenge); } catch { return false; }
  const result = await db.adminMfaChallenge.updateMany({
    where: {
      challengeHash, userId, sessionId, purpose,
      consumedAt: null,
      expiresAt: { gt: now },
      session: { userId, endedAt: null, revokedAt: null, expiresAt: { gt: now } },
    },
    data: { consumedAt: now },
  });
  return result.count === 1;
}
