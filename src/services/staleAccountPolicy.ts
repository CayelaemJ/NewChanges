// Inactivity automation must not make a service unrecoverable by automatically
// disabling a superadministrator. Privileged account retirement is a deliberate
// human-approved administrative action.
export interface StaleAccountCandidate {
  role: string;
  createdAt: Date | string;
  sessions: Array<{ createdAt: Date | string; lastSeenAt?: Date | string | null }>;
}
export function shouldAutoDeactivateAccount(account: StaleAccountCandidate, cutoff: Date): boolean {
  if (account.role === "SUPERADMIN") return false;
  // Session creation is not last activity: a still-active 30-day-old session
  // can have been used in the last minute. The caller selects the latest
  // lastSeenAt, not the latest creation date.
  const session = account.sessions[0];
  const last = session ? (session.lastSeenAt ?? session.createdAt) : account.createdAt;
  const lastSeen = new Date(last).getTime();
  return Number.isFinite(lastSeen) && lastSeen < cutoff.getTime();
}
