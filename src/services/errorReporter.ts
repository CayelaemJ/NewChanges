// ════════════════════════════════════════════════════════════════════
//  OPTIONAL ERROR REPORTING WEBHOOK
//  Forwards redacted error events to an external collector (e.g. a Sentry
//  relay, an HTTP log drain, or a Slack-compatible endpoint) when
//  ERROR_WEBHOOK_URL is configured. Fire-and-forget: reporting must never
//  throw back into the request path, and never include request bodies,
//  cookies, tokens or other sensitive values.
// ════════════════════════════════════════════════════════════════════

export interface ErrorReport {
  level: "error" | "fatal";
  message: string;
  /** Safe, non-sensitive context: route, method, status code, version. */
  context?: Record<string, string | number | boolean | null | undefined>;
}

export async function reportErrorWebhook(report: ErrorReport): Promise<void> {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        service: "empower-fin-dashboard-portal",
        version: "0.10.0",
        level: report.level,
        message: report.message.slice(0, 500),
        context: report.context ?? {},
        at: new Date().toISOString(),
      }),
    });
  } catch {
    /* best-effort: a failed report must never affect the application */
  } finally {
    clearTimeout(timeout);
  }
}
