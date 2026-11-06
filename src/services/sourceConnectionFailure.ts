// Driver exceptions and remote server banners are untrusted and may contain
// credentials, connection URLs, SQL text or private infrastructure details.
// Return only allowlisted failure classes to API clients and audit records.
const SAFE_CODES: Record<string, string> = {
  ECONNREFUSED: "Source connection refused; check the configured endpoint.",
  ETIMEDOUT: "Source connection timed out.",
  ENOTFOUND: "Source hostname could not be resolved.",
  EAI_AGAIN: "Source DNS lookup failed.",
  ECONNRESET: "Source connection was reset.",
  ER_ACCESS_DENIED_ERROR: "Source database rejected the credentials.",
  "28P01": "Source database rejected the credentials.",
  "28000": "Source database rejected the credentials.",
};

const TLS_REQUIRED = "Source SQL connection requires TLS in production.";
const TRUST_REQUIRED = "Source SQL connection requires trusted certificate verification in production.";
const DEFAULT_FAILURE = "Source connection or validation failed. Check configuration and server diagnostics.";
const SAFE_MESSAGES = new Set([...Object.values(SAFE_CODES), TLS_REQUIRED, TRUST_REQUIRED, DEFAULT_FAILURE]);

export function safeSourceConnectionFailure(error: unknown): string {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string" && Object.hasOwn(SAFE_CODES, code)) return SAFE_CODES[code];
  const message = error instanceof Error ? error.message : "";
  if (SAFE_MESSAGES.has(message)) return message;
  const wrapped = /^Could not open (?:POSTGRESQL|MYSQL|MSSQL) source connection\. (.+)$/.exec(message);
  if (wrapped && SAFE_MESSAGES.has(wrapped[1])) return wrapped[1];
  if (/requires encrypted SQL transport in production$/.test(message)) return TLS_REQUIRED;
  if (/requires trusted server certificate verification in production$/.test(message)) return TRUST_REQUIRED;
  return DEFAULT_FAILURE;
}
