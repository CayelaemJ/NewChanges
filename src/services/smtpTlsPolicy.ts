// Reject administrator-configurable SMTP downgrade in production.
// Port 587 with STARTTLS and port 465 with implicit TLS are both supported.
export interface SmtpTlsConfig {
  smtpSecure?: boolean | null;
  smtpRequireTls?: boolean | null;
  smtpRejectUnauthorized?: boolean | null;
}
export function assertSecureSmtpTls(config: SmtpTlsConfig, environment: string | undefined = process.env.NODE_ENV): void {
  if (environment !== "production") return;
  if (config.smtpRejectUnauthorized !== true) {
    throw new Error("Production SMTP must verify the remote TLS certificate");
  }
  if (config.smtpSecure !== true && config.smtpRequireTls !== true) {
    throw new Error("Production SMTP requires implicit TLS or mandatory STARTTLS");
  }
}
