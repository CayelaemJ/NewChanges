// Redact secrets before persisting audit details or human-readable summaries.
// A key-based filter alone is insufficient: upstream errors may embed credentials
// in otherwise harmless fields such as "message", "notes" or "summary".
const SENSITIVE_AUDIT_KEY =
  /password|passphrase|api[_-]?key|secret|token|authorization|cookie|webhook|smtp|private[_-]?key|recovery[_-]?(?:key|code)|grant[_-]?code|connection[_-]?string|dsn|credential/i;

const SENSITIVE_AUDIT_TEXT =
  /(?:https:\/\/hooks\.slack(?:-gov)?\.com\/services\/[^\s"'<>]+)|(?:[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@)|(?:-----BEGIN [A-Z ]*PRIVATE KEY-----)|(?:\b(?:bearer|basic)\s+[a-z0-9._~+\/-]{8,})|(?:\b(?:password|passphrase|api[_-]?key|secret|access[_-]?token|auth[_-]?token|authorization|cookie|smtp[_-]?password|connection[_-]?string|dsn|credential)\s*[:=]\s*\S+)/i;

export function redactAuditText(value: unknown): string {
  const text = String(value ?? "");
  return SENSITIVE_AUDIT_TEXT.test(text) ? "[REDACTED]" : text;
}

export function redactAuditDetail(value: unknown): unknown {
  const seen = new WeakSet<object>();
  const walk = (current: unknown, depth: number): unknown => {
    if (typeof current === "string") return redactAuditText(current);
    if (current == null || typeof current !== "object") return current;
    if (depth > 24 || seen.has(current)) return "[REDACTED]";
    if (current instanceof Date) return current.toISOString();
    seen.add(current);
    const result: unknown = Array.isArray(current)
      ? current.map(item => walk(item, depth + 1))
      : Object.fromEntries(Object.entries(current).map(([key, nested]) => [
          key, SENSITIVE_AUDIT_KEY.test(key) ? "[REDACTED]" : walk(nested, depth + 1),
        ]));
    seen.delete(current);
    return result;
  };
  return walk(value, 0);
}
