// Address-only email policy for notification and report delivery.
// Avoid permissive parsers that accept display names, header delimiters,
// control characters or malformed persisted recipients.
export function validNotificationEmailAddress(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 3 || value.length > 254 ||
      value.trim() !== value || /[\p{C}\p{Z}]/u.test(value)) return false;

  const at = value.indexOf("@");
  if (at < 1 || at !== value.lastIndexOf("@")) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > 64 || domain.length > 253 ||
      local.startsWith(".") || local.endsWith(".") || local.includes("..") ||
      !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;

  const labels = domain.split(".");
  if (labels.length < 2 || labels.some(label =>
    label.length < 1 || label.length > 63 ||
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
  )) return false;
  // Reject all-numeric TLDs and malformed ASCII hostname suffixes.
  return /^[A-Za-z][A-Za-z0-9-]*$/.test(labels[labels.length - 1]);
}
