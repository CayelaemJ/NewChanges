// HTML in notification emails is not an XSS sink in normal mail clients,
// but unescaped account names and telemetry can still inject attacker-controlled markup.
export function escapeNotificationHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"} as Record<string,string>)[c]);
}

// Password-setup/reset links must never use a javascript:, data:, or untrusted
// scheme, nor let configuration inject HTML attributes into email templates.
export function safePortalBaseUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || value.trim() !== value || value.length > 2048) return null;
  try {
    const u = new URL(value);
    if (u.username || u.password || u.search || u.hash || u.pathname !== "/") return null;
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(local && u.protocol === "http:" && process.env.NODE_ENV !== "production")) return null;
    return u.origin;
  } catch { return null; }
}

export function safeEmailColor(value: unknown, fallback: string): string {
  const raw = String(value ?? "").replace(/^#/, "");
  return "#" + (/^[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback);
}

export function notificationPlainText(value: unknown): string {
  // Unicode control-category matching avoids explicit control-code regex ranges,
  // which static lint rules reject, and also covers C1 controls (U+0080-009F).
  return String(value ?? "").replace(/[\p{Cc}<>]/gu," ").trim().slice(0,200);
}
