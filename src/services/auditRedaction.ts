// Apply at the persistence boundary, not only in individual route handlers.
// Structured audit records must never retain plaintext bearer credentials.
const SENSITIVE_AUDIT_KEY =
  /password|passphrase|api[_-]?key|secret|token|authorization|cookie|webhook|smtp|private[_-]?key|recovery[_-]?(?:key|code)|grant[_-]?code|connection[_-]?string|dsn|credential/i;

export function redactAuditDetail(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactAuditDetail);
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    output[key] = SENSITIVE_AUDIT_KEY.test(key) ? "[REDACTED]" : redactAuditDetail(nested);
  }
  return output;
}
