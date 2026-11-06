// Admin settings are JSON, not trusted typed objects. Coercing "false" to true
// can unexpectedly enable synthetic-data mode, disable controls or alter TLS.
export function strictEmailSettingBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be true or false`);
  return value;
}

export function strictSmtpPort(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error("SMTP port must be an integer between 1 and 65535");
  return value;
}

export function strictStaleDeactivateDays(value: unknown): number | null {
  if (value == null || value === 0) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 7 || value > 3650)
    throw new Error("Inactivity threshold must be 0 (off) or 7 to 3650 whole days");
  return value;
}
