// Report schedule handlers can receive Prisma, database and upstream errors.
// Those errors may contain SQL, connection URLs, tenant identifiers or secrets.
// Only explicit, application-authored messages are safe to return to clients.
export type ReportSchedulePublicFailure = {
  statusCode: 400 | 403 | 500 | 502 | 503;
  message: string;
};

const BAD_REQUEST = new Set([
  "Email delivery is not configured. Ask an administrator to complete System Email Setup first.",
  "employer not found",
  "unsupported report frequency",
  "send time must be HH:MM",
  "timezone is not valid",
  "send date is required for a one-off report",
  "send date is invalid",
  "send date/time must be in the future",
  "weekday must be Monday (1) to Sunday (7)",
  "day of month must be between 1 and 31",
  "a report can be sent to a maximum of 10 recipients",
  "invalid recipient email",
  "period must be YYYY-MM",
  "schedule not found",
  "To change report filters or frequency, delete the schedule and create a new one.",
  "Cannot reactivate a report whose owner lacks access or has invalid recipients",
]);

const FORBIDDEN = new Set([
  "you do not have access to this employer",
  "you cannot edit this schedule",
  "you cannot delete this schedule",
  "you cannot send this schedule",
  "Report delivery blocked: owner access or recipient settings have changed.",
]);

const DELIVERY_FAILURES = new Set([
  "SMTP authentication failed",
  "SMTP connection failed",
  "SMTP connection refused",
  "Email delivery timed out",
  "SMTP TLS verification failed",
  "Email delivery test failed. Check provider settings and delivery logs.",
  "Email delivery failed; retry status could not be persisted",
]);

export function publicReportScheduleFailure(error: unknown): ReportSchedulePublicFailure {
  const message = error instanceof Error ? error.message : "";
  if (BAD_REQUEST.has(message)) return { statusCode: 400, message };
  if (FORBIDDEN.has(message)) return { statusCode: 403, message };
  if (message === "Dashboard source is not ready; report delivery is deferred until a successful sync.")
    return { statusCode: 503, message };
  if (DELIVERY_FAILURES.has(message) || /^Resend request failed \\(HTTP [1-5][0-9]{2}\\)$/.test(message))
    return { statusCode: 502, message };
  // Do not reflect untrusted error text even when it looks like a validation
  // error, or when a database driver returns a familiar-looking code.
  return { statusCode: 500, message: "Report schedule operation failed. Please try again later." };
}
