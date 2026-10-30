// Fail-closed authorization policy for future server-side administrator MFA.
// This module alone does not enroll authenticators or enforce HTTP routes.
export const ADMIN_MFA_MAX_AGE_MS = 10 * 60 * 1000;

export function canPerformPrivilegedAction({
  role, active, sessionId, sessionEndedAt, sessionRevokedAt,
  proofSessionId, proofUserId, userId, verifiedAt, now = Date.now(),
}) {
  if (!['ADMIN','SUPERADMIN'].includes(role) || active !== true) return false;
  if (!sessionId || !userId || sessionEndedAt || sessionRevokedAt) return false;
  if (proofSessionId !== sessionId || proofUserId !== userId) return false;
  if (typeof verifiedAt !== 'number' || !Number.isFinite(verifiedAt)) return false;
  const age = now - verifiedAt;
  return age >= 0 && age <= ADMIN_MFA_MAX_AGE_MS;
}
