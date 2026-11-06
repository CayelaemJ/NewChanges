// Email provider errors are untrusted. SMTP server banners and HTTP error bodies
// can contain URLs, credentials, message headers and private infrastructure
// details. Never persist or return their raw text to the admin settings API.
const SMTP_FAILURES: Record<string, string> = {
  EAUTH: "SMTP authentication failed",
  ECONNECTION: "SMTP connection failed",
  ECONNREFUSED: "SMTP connection refused",
  ETIMEDOUT: "Email delivery timed out",
  ESOCKET: "SMTP connection failed",
  ETLS: "SMTP TLS verification failed",
};

export function safeEmailDeliveryFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  // This exact, internally constructed error contains only an HTTP status,
  // never the untrusted response body or a configured API credential.
  if (/^Resend request failed \(HTTP [1-5][0-9]{2}\)$/.test(message))
    return message;
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : undefined;
  if (typeof code === "string" && Object.hasOwn(SMTP_FAILURES, code))
    return SMTP_FAILURES[code];
  return "Email delivery test failed. Check provider settings and delivery logs.";
}
