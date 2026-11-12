import { validNotificationEmailAddress } from "./notificationEmailAddress.js";

// Administrator alert destinations are persisted as a comma-separated list.
// Validate before saving and again before sending to fail closed on legacy data.
export function parseAlertEmailRecipients(value: unknown): string[] {
  if (value == null || value === "") return [];
  if (typeof value !== "string" || value.length > 2549) throw new Error("invalid alert recipients");
  const recipients = value.split(",").map(part => part.trim());
  if (recipients.length > 10 || recipients.some(address => !validNotificationEmailAddress(address)))
    throw new Error("invalid alert recipients");
  const unique = new Set(recipients.map(address => address.toLowerCase()));
  if (unique.size !== recipients.length) throw new Error("duplicate alert recipients");
  return recipients;
}
