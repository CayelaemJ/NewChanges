// Slack incoming webhook URL is a bearer credential, not a general-purpose URL.
// Do not permit arbitrary destinations for notification delivery.
export function allowedSlackWebhookUrl(raw: unknown): raw is string {
  if (typeof raw !== "string" || !raw || raw.length > 2048 || raw.trim() !== raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" &&
      (url.hostname === "hooks.slack.com" || url.hostname === "hooks.slack-gov.com") &&
      !url.username && !url.password && !url.port && !url.search && !url.hash &&
      /^\/services\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(url.pathname);
  } catch { return false; }
}
