// Inactivity automation must not make a service unrecoverable by automatically
// disabling a superadministrator. Privileged account retirement is a deliberate
// human-approved administrative action.
export interface StaleAccountCandidate {
  role: string;
  createdAt: Date | string;
  sessions: Array<{ createdAt: Date | string }>;
}
export function shouldAutoDeactivateAccount(account: StaleAccountCandidate, cutoff: Date): boolean {
  if (account.role === "SUPERADMIN") return false;
  const last = account.sessions[0]?.createdAt ?? account.createdAt;
  const lastSeen = new Date(last).getTime();
  return Number.isFinite(lastSeen) && lastSeen < cutoff.getTime();
}
