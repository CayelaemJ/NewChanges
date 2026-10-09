// ════════════════════════════════════════════════════════════════════
//  BOOT-TIME CONFIGURATION VALIDATION
//  Fails fast on missing/invalid *required* settings so a misconfigured
//  deployment never starts serving traffic. Warnings are logged but do not
//  block startup (the application degrades gracefully for optional features).
// ════════════════════════════════════════════════════════════════════

type Env = Record<string, string | undefined>;

export interface ConfigIssue {
  level: "error" | "warn";
  message: string;
}

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off"]);
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function validateConfig(env: Env = process.env): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const isProduction = env.NODE_ENV === "production";
  const err = (message: string) => issues.push({ level: "error", message });
  const warn = (message: string) => issues.push({ level: "warn", message });

  // Required in production: the application cannot function without a database.
  if (isProduction && !env.DATABASE_URL) err("DATABASE_URL is required in production.");
  if (env.DATABASE_URL && !/^(postgres(ql)?|mysql|sqlserver):\/\//i.test(env.DATABASE_URL)) {
    warn("DATABASE_URL does not look like a supported connection string.");
  }

  // Public base URL powers canonical/OG/sitemap links and the same-origin write
  // check. Optional, but validated when present.
  if (env.PUBLIC_BASE_URL) {
    try {
      const u = new URL(env.PUBLIC_BASE_URL);
      if (!/^https?:$/.test(u.protocol)) err("PUBLIC_BASE_URL must be an http(s) URL.");
    } catch {
      err("PUBLIC_BASE_URL is not a valid URL.");
    }
  } else if (isProduction) {
    warn("PUBLIC_BASE_URL is not set; canonical/OG/sitemap links and the cross-origin write check fall back to request headers.");
  }

  // Boolean-ish flags.
  for (const key of ["COOKIE_SECURE", "TRUST_PROXY"]) {
    const v = env[key];
    if (v !== undefined && !TRUE.has(v.toLowerCase()) && !FALSE.has(v.toLowerCase())) {
      err(`${key} must be a boolean value (true/false).`);
    }
  }

  // Numeric settings.
  if (env.PORT !== undefined && !(Number.isInteger(Number(env.PORT)) && Number(env.PORT) > 0)) {
    err("PORT must be a positive integer.");
  }
  if (env.UPLOAD_MAX_BYTES !== undefined && !(Number(env.UPLOAD_MAX_BYTES) > 0)) {
    err("UPLOAD_MAX_BYTES must be a positive number.");
  }

  // Email/contact configuration: the contact form and legal pages degrade
  // without these, so they are warnings rather than hard failures.
  if (env.CONTACT_EMAIL && !EMAIL_RE.test(env.CONTACT_EMAIL)) {
    err("CONTACT_EMAIL is not a valid email address.");
  } else if (isProduction && !env.CONTACT_EMAIL) {
    warn("CONTACT_EMAIL is not set; the contact form is disabled and legal pages show a placeholder.");
  }

  if (isProduction && env.COOKIE_SECURE !== undefined && FALSE.has(env.COOKIE_SECURE.toLowerCase())) {
    warn("COOKIE_SECURE=false in production: session cookies will be sent over plain HTTP.");
  }

  return issues;
}

/**
 * Validate configuration and terminate the process if any error-level issue is
 * found. Called once at startup, before the HTTP listener opens.
 */
export function assertValidConfig(
  env: Env = process.env,
  log?: { warn: (obj: unknown, msg?: string) => void; error: (obj: unknown, msg?: string) => void },
): void {
  const issues = validateConfig(env);
  const warn = log?.warn ?? ((obj: unknown, msg?: string) => console.warn(msg ?? obj));
  const error = log?.error ?? ((obj: unknown, msg?: string) => console.error(msg ?? obj));
  for (const issue of issues.filter((i) => i.level === "warn")) warn({ config: issue.message }, "config warning");
  for (const issue of issues.filter((i) => i.level === "error")) error({ config: issue.message }, "config error");
  const errorCount = issues.filter((i) => i.level === "error").length;
  if (errorCount > 0) {
    error({ count: errorCount }, "refusing to start: invalid configuration");
    process.exit(1);
  }
}
