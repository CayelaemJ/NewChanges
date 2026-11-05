// Control-plane availability policy: the final active superadministrator
// must not be demoted or disabled through ordinary account management.
export function removesActiveSuperadmin(
  current: { role: string; active: boolean },
  patch: { role?: string; active?: boolean },
): boolean {
  return current.role === "SUPERADMIN" && current.active &&
    (patch.role !== undefined && patch.role !== "SUPERADMIN" || patch.active === false);
}

export function assertSuperadminRetirementAllowed(
  current: { role: string; active: boolean },
  patch: { role?: string; active?: boolean },
  activeSuperadminCount: number,
): void {
  if (removesActiveSuperadmin(current, patch) && activeSuperadminCount <= 1)
    throw new Error("Cannot deactivate or demote the last active superadministrator");
}
