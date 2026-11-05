// CSV quoting prevents delimiter injection; this additional text policy prevents
// spreadsheet applications from interpreting attacker-controlled cells as formulas.
// Keep numeric values numeric, including legitimate negative numbers.
export function csvEscape(value: unknown): string {
  if (value == null) return "";
  const numeric = typeof value === "number" || typeof value === "bigint";
  const text = value instanceof Date ? value.toISOString()
    : typeof value === "object" ? JSON.stringify(value)
    : String(value);
  // Spreadsheet applications may skip leading spaces, CR/LF and invisible
  // characters before checking = + - @. Prefix a literal apostrophe so that
  // user-controlled text is interpreted as text rather than a formula.
  const dangerous = !numeric && /^[\u0000-\u0020\u007f\u200b-\u200d\u2060\ufeff]*[=+\-@]/u.test(text);
  const safe = dangerous ? "'" + text : text;
  return /[",\r\n]/.test(safe) ? '"' + safe.replace(/"/g, '""') + '"' : safe;
}
