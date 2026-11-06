// Email configuration routes must not expose raw Prisma or SMTP exceptions.
// Driver messages and remote banners can contain credentials and internal hosts.
export type EmailSettingsPublicFailure = { statusCode: 400 | 500 | 502; message: string };

const CONFIG_ERRORS = new Set([
  "email provider must be SMTP or Resend",
  "EMAIL_PROVIDER must be smtp or resend",
  "default timezone is not a valid IANA timezone",
  "Portal base URL must be a secure HTTPS origin",
  "Slack webhook must be an HTTPS Slack incoming-webhook URL",
  "from email is not valid",
  "reply-to email is not valid",
  "Resend From email is not valid",
  "Enter a valid test recipient email",
  "SMTP host is required",
  "SMTP port is required",
  "A valid From email is required",
  "A valid Resend From email is required",
  "SMTP password is required when an SMTP username is supplied",
  "RESEND_API_KEY is required when EMAIL_PROVIDER=resend",
  "Production SMTP must verify the remote TLS certificate",
  "Production SMTP requires implicit TLS or mandatory STARTTLS",
]);

const DELIVERY_ERRORS = new Set([
  "SMTP authentication failed",
  "SMTP connection failed",
  "SMTP connection refused",
  "Email delivery timed out",
  "SMTP TLS verification failed",
  "Email delivery test failed. Check provider settings and delivery logs.",
]);

export function publicEmailSettingsFailure(error: unknown): EmailSettingsPublicFailure {
  const message = error instanceof Error ? error.message : "";
  if (CONFIG_ERRORS.has(message)) return { statusCode: 400, message };
  if (DELIVERY_ERRORS.has(message) || /^Resend request failed \(HTTP [1-5][0-9]{2}\)$/.test(message))
    return { statusCode: 502, message };
  return { statusCode: 500, message: "Email settings operation failed. Please try again later." };
}
