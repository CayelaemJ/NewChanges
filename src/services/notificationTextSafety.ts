// HTML in notification emails is not an XSS sink in normal mail clients,
// but unescaped account names and telemetry can still inject attacker-controlled markup.
export function escapeNotificationHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) =>
    ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"} as Record<string,string>)[c]);
}

export function notificationPlainText(value: unknown): string {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f<>]/g," ").trim().slice(0,200);
}
