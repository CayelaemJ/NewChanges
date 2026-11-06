// Scheduled reports are durable. A permission change must take effect at
// delivery time, not only when a schedule was originally created.
// This pure policy is shared by manual and automatic delivery checks.
import { validNotificationEmailAddress } from "./notificationEmailAddress.js";
export type ReportDeliveryOwner = {
  active: boolean;
  role: string;
  email: string;
  links: readonly { employerId: string }[];
};

export function reportDeliveryAllowed(
  owner: ReportDeliveryOwner | null | undefined,
  employerId: string,
  recipients: unknown,
): boolean {
  if (!owner?.active || !employerId || !validNotificationEmailAddress(owner.email)) return false;
  const admin = owner.role === "ADMIN" || owner.role === "SUPERADMIN";
  if (!admin && (
    !["EMPLOYER_MANAGER", "PORTFOLIO_MANAGER", "VIEWER"].includes(owner.role) ||
    !Array.isArray(owner.links) ||
    !owner.links.some(link => link.employerId === employerId)
  )) return false;

  // Old persisted schedules may predate current recipient validation.
  // Never silently fall back to another address or send to an unknown target.
  if (!Array.isArray(recipients) || recipients.length < 1 || recipients.length > 10 ||
      recipients.some(value => typeof value !== "string" || !validNotificationEmailAddress(value))) return false;

  // An admin can explicitly configure external recipients. That permission is
  // revoked if the owner is later demoted, even when they retain employer access.
  if (!admin && (
    recipients.length !== 1 ||
    recipients[0].toLowerCase() !== owner.email.toLowerCase()
  )) return false;

  return true;
}
