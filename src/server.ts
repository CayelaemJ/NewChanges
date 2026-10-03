// ════════════════════════════════════════════════════════════════════
//  API SERVER (Fastify + TypeScript)
//  Serves JSON shaped exactly like the frontend DATA / PORTFOLIO objects,
//  so the existing HTML prototype wires up by swapping its constants for
//  fetch() calls — no re-shaping needed.
// ════════════════════════════════════════════════════════════════════

import Fastify, { FastifyRequest, FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import cookie from "@fastify/cookie";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { prisma, snapshotEmployer, getDashboardPayload, monthKey } from "./services/snapshotBuilder.js";
import { REPORT_FORMATS, LOAD_ORDER, getFormat } from "./services/reportFormats.js";
import { csvTemplate, xlsxTemplate, formatManifest } from "./services/templateGenerator.js";
import { uploadAndValidate, commitBatch, revertBatch, resetAllData } from "./services/importService.js";
import { startUploadJob, getUploadJob, startCommitJob, getCommitJob } from "./services/asyncJobs.js";
import { startSyncJob, getSyncJob } from "./services/syncJobs.js";
import { startDailyRefresh, triggerRefreshNow } from "./services/dailyRefresh.js";
import { getConfig as getSyncConfig, saveConfig as saveSyncConfig, publicConfig as publicSyncConfig, testConnection as testSyncConnection, runSync, recentSyncLogs } from "./services/syncService.js";
import { listPartners, createPartner, updatePartner, deletePartner, assignUserToPartner, assignEmployerToPartner, themeForUser, themeForSlug } from "./services/partnerService.js";
import { login, resolveSession, destroySession, destroySessionById, destroyAllSessionsForUser, canViewEmployer, canAccessModule, allowedEmployerIds, AuthUser, isAdminRole } from "./services/authService.js";
import { createUser, listUsers, updateUser, resetPassword, completeSetup, deactivateSelf, listRevokedUsers, deleteUserPermanently, requestPasswordReset } from "./services/userService.js";
import { recordEvent, engagementSummary } from "./services/analyticsService.js";
import { notifyAdmins, notifyScoreChangeIfCurrentPeriod, runStaleAccountCheck, runWeeklyDigestIfDue } from "./services/automationService.js";
import { logAdminAction, listAuditLog } from "./services/auditService.js";
import { complianceOverview, listProcessingActivities, createProcessingActivity, listDataSubjectRequests, createDataSubjectRequest, updateDataSubjectRequest, listComplianceVendors, createComplianceVendor, listRetentionPolicies, createRetentionPolicy, listSecurityIncidents, createSecurityIncident } from "./services/complianceService.js";
import { requestSecurityContext, enrichSecurityContext, recordLoginEvent, securityOverview, listSessions, listLoginEvents, listSecurityAlerts, resolveSecurityAlert, pruneSecurityHistory, listSecurityDevices, listDataAccessEvents, recordDataAccessEvent, databaseSecuritySnapshot } from "./services/securityService.js";
import { exportAuditLogCsv, exportSecurityAuditLogCsv, exportImportBatchCsv } from "./services/exportService.js";
import { listAnalyticsRoutes, saveAnalyticsRoute } from "./services/syncService.js";
import { enterpriseOperationsOverview, dataQualityOverview } from "./services/enterpriseOperationsService.js";
import { checkMysqlReadReplica } from "./services/sourceAdapter.js";
import { subscribeAdminEvents } from "./services/adminEventStream.js";
import { ensureSectionDefaults, listSections, updateSection, grantUserSection, revokeUserSection, sectionsForUser } from "./services/sectionService.js";
import { publicEmailConfig, saveEmailConfig, testEmailConnection, createReportSchedule, listReportSchedules, updateReportSchedule, deleteReportSchedule, sendReportNow, recentReportDeliveries, runDueReports } from "./services/reportScheduler.js";
import type { ScheduleInput } from "./services/reportScheduler.js";
import { runMLOpsAssessment, getMLOpsPortfolioAssessment, recordMLOpsFeedback, listMLOpsModels, registerMLOpsModel, promoteMLOpsModel, rollbackMLOpsModel, listMLOpsEvents } from "./services/mlopsService.js";
import { getBrandLearningProfile, learnFromBrandUpload, recordBrandCorrection } from "./services/brandLearningService.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = [join(__dirname, "public"), join(__dirname, "..", "public")]
  .find((p) => existsSync(join(p, "dashboard.html"))) ?? join(__dirname, "..", "public");

const MAX_UPLOAD_BYTES = Number(process.env.UPLOAD_MAX_BYTES ?? 50 * 1024 * 1024);

const app = Fastify({
  logger: { redact: ["req.headers.authorization", "req.headers.cookie", "res.headers[\"set-cookie\"]"] },
  // Behind Railway's proxy, req.ip is the proxy unless this is enabled, which
  // collapsed every visitor into a single rate-limit bucket.
  trustProxy: process.env.TRUST_PROXY === "false" ? false : true,
  bodyLimit: 8 * 1024 * 1024, // JSON bodies (partner logos are data URLs); file uploads are streamed via multipart and capped separately
  connectionTimeout: 0,
  keepAliveTimeout: 75_000,
  maxRequestsPerSocket: 1000,
});

// Node 20 defaults are too aggressive for slow uploads behind proxies.
app.server.headersTimeout = 180_000;
app.server.requestTimeout = 600_000;

// ── security hardening ──────────────────────────────────────────────────────
// The portal uses cookie-backed browser sessions. Keep browser-originated state
// changes same-origin, add defensive security headers, and apply lightweight
// in-process throttling to slow credential stuffing / abuse. Railway can sit
// behind a proxy, so this intentionally uses Fastify's resolved request IP and
// does not trust arbitrary application-provided identity headers.
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; "),
};

function applySecurityHeaders(reply: FastifyReply) {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) reply.header(key, value);
  if (COOKIE_SECURE) reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}

const rateBuckets = new Map<string, { count: number; resetAt: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 240;
const AUTH_RATE_LIMIT = 12;
const AUTH_WINDOW_MS = 10 * 60_000;
function rateLimit(reply: FastifyReply, key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const current = rateBuckets.get(key);
  if (!current || current.resetAt <= now) {
    rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  current.count += 1;
  if (current.count > limit) {
    reply.header("Retry-After", Math.ceil((current.resetAt - now) / 1000));
    reply.code(429).send({ error: "too many requests; try again later" });
    return false;
  }
  return true;
}

app.addHook("onRequest", async (req, reply) => {
  applySecurityHeaders(reply);
  const path = req.url.split("?", 1)[0];
  if (path.startsWith("/api/")) {
    reply.header("Cache-Control", "no-store");
    reply.header("Pragma", "no-cache");
  }
  const ip = req.ip || "unknown";
  const authPath = path === "/api/auth/login" || path === "/api/auth/forgot-password" || path === "/api/auth/set-password" || path === "/api/contact";
  if (!rateLimit(reply, `${authPath ? "auth" : "api"}:${ip}`, authPath ? AUTH_RATE_LIMIT : RATE_LIMIT, authPath ? AUTH_WINDOW_MS : RATE_WINDOW_MS)) return;

  // Cookie-authenticated state-changing API calls must originate from this
  // application. Bearer-token API clients are exempt because they don't carry
  // the browser session cookie and can legitimately omit Origin/Referer.
  if (req.method !== "GET" && req.method !== "HEAD" && path.startsWith("/api/")) {
    const authHeader = req.headers.authorization;
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    if (!authHeader) {
      const hasSessionCookie = Boolean(req.cookies?.session);
      const forwardedProto = String(req.headers["x-forwarded-proto"] || req.protocol).split(",")[0].trim();
      const configuredOrigin = String(process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
      const expectedOrigin = configuredOrigin || `${forwardedProto}://${req.headers.host}`;
      const suppliedOrigin = origin || (() => { try { return new URL(referer as string).origin; } catch { return ""; } })();
      // Browser session requests must prove same-origin. Bearer-token clients
      // remain usable without Origin/Referer because they have no browser cookie.
      if (hasSessionCookie && !suppliedOrigin) return reply.code(403).send({ error: "same-origin request required" });
      // A custom domain plus the platform domain (or a preview URL) are both legitimate; a cross-site
      // attacker's Origin can never equal the host this request was addressed to.
      const hostOrigin = `${forwardedProto}://${req.headers.host}`;
      if (suppliedOrigin && suppliedOrigin !== expectedOrigin && suppliedOrigin !== hostOrigin) {
        return reply.code(403).send({ error: "cross-origin request rejected" });
      }
    }
  }
});


// Sensitive application-data access audit. This is intentionally scoped to
// authenticated admin/data surfaces and does not log request bodies or payloads.
app.addHook("onResponse", async (req, reply) => {
  const path = req.url.split("?", 1)[0];
  const sensitive = path.startsWith("/api/admin/") || path.startsWith("/api/dashboard") || path.startsWith("/api/portfolio");
  if (!sensitive) return;
  try {
    const token = req.cookies?.session;
    const user = token ? await resolveSession(token) : null;
    if (!user) return;
    const context = requestSecurityContext(req);
    await recordDataAccessEvent({
      userId: user.id,
      actorEmail: user.email,
      method: req.method,
      route: path,
      resource: path.split("/").filter(Boolean).slice(1, 3).join("/"),
      context,
      statusCode: reply.statusCode,
      durationMs: undefined,
    });
  } catch {}
});
// Periodically discard old rate-limit buckets so a long-lived process does not
// retain one entry forever for every IP that ever touched it.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) if (bucket.resetAt <= now) rateBuckets.delete(key);
}, 5 * 60_000).unref();

app.setErrorHandler((error, req, reply) => {
  req.log.error({ err: error, method: req.method, url: req.url }, "unhandled request error");
  if (reply.sent) return;
  const status = Number((error as any)?.statusCode);
  if (status >= 400 && status < 500) { const message = error instanceof Error ? error.message : "request rejected"; return reply.code(status).send({ error: message }); }
  return reply.code(500).send({ error: "internal server error" });
});

app.register(cookie);
app.register(multipart, {
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 10 },
});

app.register(fastifyStatic, {
  root: join(PUBLIC_DIR, "react"),
  prefix: "/react/",
  decorateReply: false,
  setHeaders(res, filePath) {
    if (/\\.(?:js|css|html)$/i.test(filePath)) {
      res.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.header("Pragma", "no-cache");
      res.header("Expires", "0");
    }
  },
});

app.register(fastifyStatic, {
  root: PUBLIC_DIR,
  prefix: "/static/",
  // The portal HTML is deployed independently of browser cache state. UI assets
  // are intentionally no-store while the product is pre-live so a deployment
  // cannot appear to retain an older navigation/integration screen.
  setHeaders(res, filePath) {
    if (/\.(?:js|css|html)$/i.test(filePath)) {
      res.header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.header("Pragma", "no-cache");
      res.header("Expires", "0");
    } else if (/\.(?:png|jpg|jpeg|webp|ico|svg|woff2?)$/i.test(filePath)) {
      // URLs are not content-hashed, so keep this short: a replaced logo/OG image reaches users within a day.
      res.header("Cache-Control", "public, max-age=86400, stale-while-revalidate=604800");
    }
  },
});

const PORT = Number(process.env.PORT ?? 3000);
const currentPeriod = () => new Date().toISOString().slice(0, 7);
const VALID_DASHBOARD_RANGES = new Set(["30d", "quarter", "all", "month", "30", "q", "latest"]);
const VALID_INCOME_BANDS = new Set(["UNDER_5K", "BAND_5_10K", "BAND_10_20K", "BAND_20_40K", "OVER_40K"]);
function dashboardQueryError(query: { period?: string; quarter?: string; range?: string; income?: string }): string | null {
  const current = currentPeriod();
  if (query.period && !/^\d{4}-(0[1-9]|1[0-2])$/.test(query.period)) return "period must be YYYY-MM";
  if (query.period && query.period > current) return `period cannot be later than ${current}`;
  if (query.quarter && !/^\d{4}-Q[1-4]$/.test(query.quarter)) return "quarter must be YYYY-Q1..YYYY-Q4";
  if (query.range && !VALID_DASHBOARD_RANGES.has(query.range)) return "range must be 30d, quarter, all or month";
  if ([query.period, query.quarter, query.range].filter((v) => v != null).length > 1) return "use period, quarter, or range — not more than one";
  if (!query.period && query.range === "month") return "range=month requires period=YYYY-MM";
  if (query.income && query.income !== "all" && !VALID_INCOME_BANDS.has(query.income)) return "income is not a supported income-band code";
  return null;
}
const escAttr = (v: string) => v.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
// Public origin used for canonical/OG URLs and the sitemap. Prefer the configured
// PUBLIC_BASE_URL; otherwise derive it from the request but only accept a sane host
// (never reflect an arbitrary Host header into markup).
function publicOrigin(req: FastifyRequest): string {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (/^https?:\/\/[a-z0-9.\-]+(:\d+)?$/i.test(configured)) return configured;
  const host = String(req.headers.host || "");
  const proto = req.protocol === "https" ? "https" : "http";
  return /^[a-z0-9.\-]+(:\d+)?$/i.test(host) ? `${proto}://${host}` : "http://localhost";
}
const CONTACT_EMAIL = (process.env.CONTACT_EMAIL || "").trim();
const siteVars = (req: FastifyRequest): Record<string, string> => ({
  BASE_URL: publicOrigin(req),
  CONTACT_EMAIL: CONTACT_EMAIL || "the portal administrator",
  PRIVACY_EMAIL: (process.env.PRIVACY_EMAIL || CONTACT_EMAIL || "the portal administrator").trim(),
  LEGAL_EMAIL: (process.env.LEGAL_EMAIL || CONTACT_EMAIL || "the portal administrator").trim(),
  INFORMATION_OFFICER: (process.env.INFORMATION_OFFICER || "our designated Information Officer").trim(),
  CONTACT_ADDRESS: (process.env.CONTACT_ADDRESS || "Deloitte Building, 5 Magwa Crescent, Midrand, 2090, Gauteng, South Africa").trim(),
});
const serveHtml = async (reply: FastifyReply, file: string, status = 200) => {
  const vars = siteVars(reply.request);
  const html = (await readFile(join(PUBLIC_DIR, file), "utf-8")).replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vars ? escAttr(vars[k]) : m));
  return reply
    .code(status)
    .header("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate")
    .header("Pragma", "no-cache")
    .header("Expires", "0")
    .header("X-Empower-Portal-Build", "0.10.0")
    .type("text/html; charset=utf-8")
    .send(html);
};

// ── auth helpers ──
async function currentUser(req: FastifyRequest): Promise<AuthUser | null> {
  const token = (req.cookies && req.cookies.session) || (req.headers.authorization?.replace("Bearer ", ""));
  return resolveSession(token);
}
// guard for API routes: returns the user or sends 401/403
async function requireUser(req: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  const user = await currentUser(req);
  if (!user) { reply.code(401).send({ error: "not signed in" }); return null; }
  return user;
}
async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> {
  const user = await requireUser(req, reply);
  if (!user) return null;
  if (user.role !== "ADMIN" && user.role !== "SUPERADMIN") { reply.code(403).send({ error: "admin only" }); return null; }
  return user;
}
function redactAuditDetail(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(redactAuditDetail);
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (/password|token|secret|authorization|smtp/i.test(key)) out[key] = "[REDACTED]";
    else out[key] = redactAuditDetail(val);
  }
  return out;
}


// ── public pages ──
app.get("/react", async (_req, reply) => reply.redirect("/react/"));
app.get("/react/", async (_req, reply) => {
  try {
    const html = await readFile(join(PUBLIC_DIR, "react", "index.html"), "utf-8");
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(html);
  } catch {
    return reply.code(503).send({ error: "React frontend has not been built yet" });
  }
});
app.get("/react/admin", async (_req, reply) => {
  try {
    const html = await readFile(join(PUBLIC_DIR, "react", "index.html"), "utf-8");
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(html);
  } catch {
    return reply.code(503).send({ error: "React frontend has not been built yet" });
  }
});
app.get("/react/dashboard", async (_req, reply) => {
  try {
    const html = await readFile(join(PUBLIC_DIR, "react", "index.html"), "utf-8");
    return reply.type("text/html; charset=utf-8").header("Cache-Control", "no-store").send(html);
  } catch {
    return reply.code(503).send({ error: "React frontend has not been built yet" });
  }
});

app.get("/favicon.ico", async (_req, reply) => reply.redirect("/static/favicon.ico"));
app.get("/contact", async (_req, reply) => serveHtml(reply, "contact.html"));
app.get("/thank-you", async (_req, reply) => serveHtml(reply, "thank-you.html"));
app.get("/robots.txt", async (req, reply) => reply.type("text/plain; charset=utf-8").header("Cache-Control", "public, max-age=3600").send(
  ["User-agent: *", "Allow: /login", "Allow: /contact", "Allow: /privacy", "Allow: /terms", "Allow: /cookies", "Allow: /static/og-image.png",
   "Disallow: /api/", "Disallow: /admin", "Disallow: /dashboard", "Disallow: /users", "Disallow: /set-password", "Disallow: /thank-you", "",
   `Sitemap: ${publicOrigin(req)}/sitemap.xml`, ""].join("\n")));
app.get("/sitemap.xml", async (req, reply) => {
  const base = publicOrigin(req), today = new Date().toISOString().slice(0, 10);
  const urls = [["/", "1.0"], ["/contact", "0.8"], ["/login", "0.8"], ["/privacy", "0.4"], ["/terms", "0.4"], ["/cookies", "0.3"]];
  return reply.type("application/xml; charset=utf-8").header("Cache-Control", "public, max-age=3600").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map(([p, pr]) => `  <url><loc>${base}${p}</loc><lastmod>${today}</lastmod><priority>${pr}</priority></url>`).join("\n") + `\n</urlset>\n`);
});

// custom 404: branded page for browsers, JSON for API clients
app.setNotFoundHandler(async (req, reply) => {
  const path = req.url.split("?", 1)[0];
  if (path.startsWith("/api/")) return reply.code(404).send({ error: "not found" });
  return serveHtml(reply, "404.html", 404);
});

// public contact / request-access form. Throttled, honeypot-protected, validated;
// delivered by SMTP to CONTACT_EMAIL. Nothing is stored beyond the outgoing email.
app.post<{ Body: { name?: unknown; email?: unknown; organisation?: unknown; message?: unknown; website?: unknown } }>("/api/contact", async (req, reply) => {
  const b = req.body ?? {};
  if (typeof b.website === "string" && b.website.trim()) return { ok: true }; // honeypot: pretend success to bots
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const name = str(b.name, 120), email = str(b.email, 254), organisation = str(b.organisation, 120), message = str(b.message, 2000);
  if (!name) return reply.code(400).send({ error: "Please enter your name." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return reply.code(400).send({ error: "Please enter a valid email address." });
  if (message.length < 10) return reply.code(400).send({ error: "Please write at least 10 characters." });
  if (!CONTACT_EMAIL) return reply.code(503).send({ error: "The contact form is not available yet. Please try again later." });
  try {
    const { sendMail } = await import("./services/reportScheduler.js");
    const e = escAttr;
    await sendMail({
      to: CONTACT_EMAIL, replyTo: email,
      subject: `Portal contact request from ${name.replace(/[\r\n]+/g, " ")}`,
      html: `<div style="font-family:Arial,sans-serif;color:#241536"><h2 style="color:#32217c">New contact request</h2><p><b>Name:</b> ${e(name)}<br><b>Email:</b> ${e(email)}<br><b>Organisation:</b> ${e(organisation || "—")}</p><p style="white-space:pre-wrap">${e(message)}</p></div>`,
    });
    return { ok: true };
  } catch (err) {
    req.log.error({ err }, "contact form delivery failed");
    return reply.code(502).send({ error: "We couldn't send your message right now. Please try again or email us directly." });
  }
});
app.get("/", async (req, reply) => {
  const user = await currentUser(req);
  if (user && canAccessModule(user, "dashboard")) return reply.redirect("/dashboard");
  return serveHtml(reply, "home.html");
});
app.get("/login", async (_req, reply) => serveHtml(reply, "login.html"));
app.get("/set-password", async (_req, reply) => serveHtml(reply, "set-password.html"));
app.get("/privacy", async (_req, reply) => serveHtml(reply, "privacy.html"));
app.get("/terms", async (_req, reply) => serveHtml(reply, "terms.html"));
app.get("/cookies", async (_req, reply) => serveHtml(reply, "cookies.html"));

// ── protected pages: redirect to /login if not allowed ──
app.get("/dashboard", async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return reply.redirect("/login");
  if (!canAccessModule(user, "dashboard")) return reply.redirect("/login");
  // Keep the canonical dashboard route on the original production dashboard.
  // The React frontend remains available separately at /react/dashboard while
  // the original dashboard remains the visual source of truth for /dashboard.
  return serveHtml(reply, "dashboard.html");
});
app.get("/admin", async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return reply.redirect("/login");
  if (!canAccessModule(user, "admin")) return reply.code(403).type("text/html").send("<h2 style='font-family:sans-serif;padding:40px'>Admins only. <a href='/dashboard'>Go to dashboard</a></h2>");
  return serveHtml(reply, "admin.html");
});
app.get("/users", async (req, reply) => {
  const user = await currentUser(req);
  if (!user || (user.role !== "ADMIN" && user.role !== "SUPERADMIN")) return reply.redirect("/login");
  return serveHtml(reply, "users.html");
});

app.get("/health", async () => ({ ok: true }));
// lets you confirm the NEW build is live: should report the live-dashboard version
app.get("/version", async () => ({ product: "empower-fin Dashboard Portal", version: "0.10.0", contractVersion: "2.6", coreSourceFeeds: 10, sourceModes: ["API", "SQL"], sqlDialects: ["POSTGRESQL", "MSSQL", "MYSQL"], channelPartners: true, scheduledReports: true, emailDelivery: "SMTP", portfolioEmployerFilter: true, portfolioMetricHelp: true, employerMetricHelp: true, uiNavigation: "account-dropdown-v2", routes: ["/login", "/dashboard", "/admin", "/users"] }));

// ════════════════════ AUTH ════════════════════
const COOKIE_SECURE = !["0", "false", "no"].includes(String(process.env.COOKIE_SECURE ?? "true").toLowerCase());
const COOKIE = { httpOnly: true, sameSite: "lax" as const, secure: COOKIE_SECURE, path: "/" };
const REMEMBER_COOKIE = { ...COOKIE, maxAge: 30 * 86400 };

app.post<{ Body: { email: string; password: string; remember?: boolean } }>("/api/auth/login", async (req, reply) => {
  const { email, password, remember } = req.body ?? ({} as any);
  if (typeof email !== "string" || typeof password !== "string" || email.length > 254 || password.length > 256) {
    return reply.code(400).send({ error: "email and password are required" });
  }
  // Per-account throttle (in addition to per-IP) to blunt distributed guessing.
  if (!rateLimit(reply, `login:${email.toLowerCase().trim()}`, 10, AUTH_WINDOW_MS)) return;
  const securityContext = await enrichSecurityContext(req);
  const result = await login(email, password, !!remember, securityContext);
  await recordLoginEvent({
    userId: result?.user.id,
    email,
    success: !!result,
    failureReason: result ? undefined : "INVALID_CREDENTIALS",
    context: securityContext,
  });
  if (!result) return reply.code(401).send({ error: "invalid email or password" });
  reply.setCookie("session", result.token, remember ? { ...REMEMBER_COOKIE, expires: result.expiresAt } : COOKIE);
  return { ok: true, user: { name: result.user.name, role: result.user.role } };
});

app.post("/api/auth/logout", async (req, reply) => {
  await destroySession(req.cookies?.session);
  reply.clearCookie("session", { path: "/", httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE });
  return { ok: true };
});

// who am I + what can I see (drives the UI)
app.get("/api/auth/me", async (req, reply) => {
  const user = await currentUser(req);
  if (!user) return reply.code(401).send({ error: "not signed in" });
  const ids = allowedEmployerIds(user);
  let employers;
  if (ids === null) {
    employers = await prisma.employer.findMany({ where: { sourceDeletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  } else {
    employers = await prisma.employer.findMany({ where: { id: { in: ids }, sourceDeletedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  }
  return {
    name: user.name, email: user.email, role: user.role,
    syntheticDataMode: Boolean((await publicEmailConfig()).syntheticDataMode),
    modules: {
      admin: canAccessModule(user, "admin"),
      dashboard: canAccessModule(user, "dashboard"),
      portfolio: canAccessModule(user, "portfolio"),
      users: isAdminRole(user),
    },
    sections: await sectionsForUser(user),
    employers,
    theme: await themeForUser(user.id),
  };
});

// complete the set-password link
app.post<{ Body: { token: string; password: string } }>("/api/auth/set-password", async (req, reply) => {
  try {
    const { token, password } = req.body ?? ({} as any);
    if (typeof token !== "string" || typeof password !== "string") return reply.code(400).send({ error: "token and password are required" });
    if (!password || password.length < 12) return reply.code(400).send({ error: "password must be at least 12 characters and include upper-case, lower-case, and numeric characters" });
    await completeSetup(token, password);
    return { ok: true };
  } catch (e: any) { return reply.code(400).send({ error: e.message }); }
});

// self-service "forgot password" — always returns { ok: true } regardless of
// whether the email matches an account, so this can't be used to enumerate
// who has an account. A tiny in-memory throttle (per email) stops someone
// from hammering the mail server; it's not a substitute for a real rate
// limiter if you add one later.
const forgotPasswordThrottle = new Map<string, number>();
app.post<{ Body: { email: string } }>("/api/auth/forgot-password", async (req, reply) => {
  const raw = req.body?.email;
  const email = typeof raw === "string" ? raw.toLowerCase().trim().slice(0, 254) : "";
  if (!email) return { ok: true };
  if (forgotPasswordThrottle.size > 5000) {
    const cutoff = Date.now() - 60_000;
    for (const [k, t] of forgotPasswordThrottle) if (t < cutoff) forgotPasswordThrottle.delete(k);
  }
  const last = forgotPasswordThrottle.get(email) || 0;
  if (Date.now() - last < 60_000) return { ok: true }; // silently no-op if requested <60s ago
  forgotPasswordThrottle.set(email, Date.now());
  try { await requestPasswordReset(email); } catch { /* never leak errors here */ }
  return { ok: true };
});

// Live one-way admin events. SSE is used for job progress; all normal API traffic stays on fetch().
app.get("/api/admin/events", async (req, reply) => {
  const admin = await requireAdmin(req, reply);
  if (!admin) return;

  const query = (req.query ?? {}) as { jobId?: string };
  const jobId = typeof query.jobId === "string" ? query.jobId.trim().slice(0, 120) : "";
  if (!jobId) return reply.code(400).send({ error: "jobId is required" });

  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event: { id: string; type: string; jobId?: string; payload: Record<string, unknown> }) => {
    res.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  };

  res.write("retry: 3000\n\n");
  res.write(": connected\n\n");

  const unsubscribe = subscribeAdminEvents(jobId, send);
  const heartbeat = setInterval(() => {
    try { res.write(`: heartbeat ${Date.now()}\n\n`); } catch {}
  }, 15000);

  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.raw.once("close", close);
  req.raw.once("aborted", close);
});

// ════════════════════ SECURITY & IDENTITY CENTER ════════════════════
app.get("/api/admin/compliance/overview", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  return complianceOverview();
});
app.get("/api/admin/compliance/processing-activities", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  return listProcessingActivities(100);
});
app.post<{ Body: Record<string, unknown> }>("/api/admin/compliance/processing-activities", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  try {
    const created = await createProcessingActivity(req.body ?? {});
    logAdminAction(admin, "compliance.processing_activity.create", `Created processing activity ${created.name}`, { targetType: "ProcessingActivity", targetId: created.id, context: requestSecurityContext(req) });
    return created;
  } catch (err) { return reply.code(400).send({ error: err instanceof Error ? err.message : "invalid processing activity" }); }
});
app.get("/api/admin/compliance/requests", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  return listDataSubjectRequests(100);
});
app.post<{ Body: Record<string, unknown> }>("/api/admin/compliance/requests", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  try {
    const created = await createDataSubjectRequest(req.body ?? {});
    logAdminAction(admin, "compliance.data_subject_request.create", `Created ${created.requestType} data subject request`, { targetType: "DataSubjectRequest", targetId: created.id, context: requestSecurityContext(req) });
    return created;
  } catch (err) { return reply.code(400).send({ error: err instanceof Error ? err.message : "invalid data subject request" }); }
});
app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>("/api/admin/compliance/requests/:id", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  try {
    const updated = await updateDataSubjectRequest(req.params.id, req.body ?? {});
    logAdminAction(admin, "compliance.data_subject_request.update", `Updated data subject request ${req.params.id}`, { targetType: "DataSubjectRequest", targetId: req.params.id, context: requestSecurityContext(req) });
    return updated;
  } catch (err) { return reply.code(400).send({ error: err instanceof Error ? err.message : "could not update request" }); }
});
app.get("/api/admin/compliance/vendors", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  return listComplianceVendors(100);
});
app.post<{ Body: Record<string, unknown> }>("/api/admin/compliance/vendors", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  try {
    const created = await createComplianceVendor(req.body ?? {});
    logAdminAction(admin, "compliance.vendor.create", `Created compliance vendor ${created.name}`, { targetType: "ComplianceVendor", targetId: created.id, context: requestSecurityContext(req) });
    return created;
  } catch (err) { return reply.code(400).send({ error: err instanceof Error ? err.message : "invalid compliance vendor" }); }
});
app.get("/api/admin/compliance/retention", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  return listRetentionPolicies(100);
});
app.post<{ Body: Record<string, unknown> }>("/api/admin/compliance/retention", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  try {
    const created = await createRetentionPolicy(req.body ?? {});
    logAdminAction(admin, "compliance.retention.upsert", `Updated retention policy ${created.dataClass}`, { targetType: "RetentionPolicy", targetId: created.id, context: requestSecurityContext(req) });
    return created;
  } catch (err) { return reply.code(400).send({ error: err instanceof Error ? err.message : "invalid retention policy" }); }
});
app.get("/api/admin/compliance/incidents", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  return listSecurityIncidents(100);
});
app.post<{ Body: Record<string, unknown> }>("/api/admin/compliance/incidents", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  try {
    const created = await createSecurityIncident(req.body ?? {});
    logAdminAction(admin, "compliance.security_incident.create", `Created security incident ${created.id}`, { targetType: "SecurityIncident", targetId: created.id, context: requestSecurityContext(req) });
    return created;
  } catch (err) { return reply.code(400).send({ error: err instanceof Error ? err.message : "invalid security incident" }); }
});

app.get("/api/admin/security/database", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  return databaseSecuritySnapshot();
});

app.get("/api/admin/security/devices", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  return listSecurityDevices(300);
});

app.get<{ Querystring: { limit?: string; userId?: string; route?: string } }>("/api/admin/security/data-access", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  return listDataAccessEvents({
    limit: Number(req.query.limit) || 200,
    userId: req.query.userId,
    route: req.query.route,
  });
});

app.get("/api/admin/security/audit-log.csv", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  reply.header("Content-Type", "text/csv; charset=utf-8");
  reply.header("Content-Disposition", `attachment; filename="security-audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  return reply.send(await exportSecurityAuditLogCsv());
});

app.get("/api/admin/security/overview", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  await pruneSecurityHistory().catch(() => {});
  return securityOverview();
});

app.get<{ Querystring: { userId?: string; status?: string; limit?: string } }>("/api/admin/security/sessions", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return listSessions({ userId: req.query.userId, status: req.query.status, limit: Number(req.query.limit) || 100 });
});

app.post<{ Params: { id: string }; Body: { reason?: string } }>("/api/admin/security/sessions/:id/revoke", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  const existing = await prisma.session.findUnique({ where: { id: req.params.id }, select: { userId: true, endedAt: true } });
  if (!existing) return reply.code(404).send({ error: "session not found" });
  if (existing.userId === admin.id) return reply.code(400).send({ error: "you cannot revoke your own current admin session here" });
  await destroySessionById(req.params.id, admin.email);
  logAdminAction(admin, "session.revoke", `Revoked session ${req.params.id}${req.body?.reason ? ": " + String(req.body.reason).slice(0, 200) : ""}`, {
    targetType: "Session", targetId: req.params.id, context: requestSecurityContext(req),
  });
  return { ok: true };
});

app.post<{ Params: { id: string }; Body: { reason?: string } }>("/api/admin/users/:id/revoke-sessions", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  if (req.params.id === admin.id) return reply.code(400).send({ error: "you cannot revoke your own admin sessions here" });
  const count = await prisma.session.count({ where: { userId: req.params.id, endedAt: null } });
  await destroyAllSessionsForUser(req.params.id, admin.email);
  logAdminAction(admin, "user.revoke_sessions", `Revoked all active sessions for user ${req.params.id}`, {
    targetType: "User", targetId: req.params.id, impactCount: count, context: requestSecurityContext(req),
  });
  return { ok: true, revokedCount: count };
});

app.get<{ Querystring: { userId?: string; email?: string; limit?: string } }>("/api/admin/security/logins", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return listLoginEvents({ userId: req.query.userId, email: req.query.email, limit: Number(req.query.limit) || 200 });
});

app.get<{ Querystring: { status?: string; limit?: string } }>("/api/admin/security/alerts", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return listSecurityAlerts({ status: req.query.status ?? "OPEN", limit: Number(req.query.limit) || 100 });
});

app.post<{ Params: { id: string } }>("/api/admin/security/alerts/:id/resolve", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  return resolveSecurityAlert(req.params.id, admin.email);
});

// ════════════════════ USER MANAGEMENT (admin only) ════════════════════
app.get("/api/users", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  const users = await listUsers();
  // Superadmin is an internal control-plane role. Ordinary admins must not
  // discover that the role exists, including through the user-management API.
  return admin.role === "SUPERADMIN" ? users : users.filter((u: any) => u.role !== "SUPERADMIN");
});
app.post<{ Body: { email: string; name: string; role: any; employerIds?: string[]; partnerId?: string; tempPassword?: string; sendSetupLink?: boolean } }>("/api/users", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  try {
    const b = req.body;
    // Ordinary admins can manage normal users, but cannot create or discover
    // the privileged control-plane role.
    if (admin.role !== "SUPERADMIN" && (b.role === "SUPERADMIN" || b.role === "ADMIN")) {
      return reply.code(400).send({ error: "invalid role" });
    }
    const created = await createUser({
      email: b.email, name: b.name, role: b.role, employerIds: b.employerIds ?? [],
      partnerId: b.partnerId, tempPassword: b.tempPassword, sendSetupLink: b.sendSetupLink, createdBy: admin.email,
    });
    logAdminAction(admin, "user.create", `Created user ${b.name} (${b.email}), role ${b.role}`, { targetType: "User", targetId: (created as any)?.id, impactCount: 1, context: requestSecurityContext(req) });
    return created;
  } catch (e: any) { return reply.code(400).send({ error: e.message }); }
});
app.patch<{ Params: { id: string }; Body: any }>("/api/users/:id", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  const input: Record<string, any> = req.body && typeof req.body === "object" ? req.body : {};
  // Ordinary admins must not be able to discover, edit or promote a user into
  // the privileged control-plane role.
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { role: true } });
  if (!target) return reply.code(404).send({ error: "user not found" });
  if (admin.role !== "SUPERADMIN" && target.role === "SUPERADMIN") return reply.code(404).send({ error: "user not found" });
  if (admin.role !== "SUPERADMIN" && (input.role === "SUPERADMIN" || input.role === "ADMIN")) return reply.code(400).send({ error: "invalid role" });
  // Allow-list fields: never pass an arbitrary client object through to the DB layer.
  const body: Record<string, any> = {};
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || !input.name.trim() || input.name.length > 120) return reply.code(400).send({ error: "name must be 1–120 characters" });
    body.name = input.name.trim();
  }
  if (input.role !== undefined) {
    if (!["ADMIN", "SUPERADMIN", "EMPLOYER_MANAGER", "PORTFOLIO_MANAGER", "VIEWER"].includes(input.role)) return reply.code(400).send({ error: "invalid role" });
    body.role = input.role;
  }
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") return reply.code(400).send({ error: "active must be true or false" });
    body.active = input.active;
  }
  if (input.employerIds !== undefined) {
    if (!Array.isArray(input.employerIds) || input.employerIds.length > 5000 || input.employerIds.some((x: unknown) => typeof x !== "string")) return reply.code(400).send({ error: "employerIds must be an array of ids" });
    body.employerIds = input.employerIds;
  }
  if ("partnerId" in input) body.partnerId = typeof input.partnerId === "string" ? input.partnerId : null;
  if (typeof input.reason === "string") body.reason = input.reason.slice(0, 300);
  if (req.params.id === admin.id && (body.active === false || (body.role && body.role !== "ADMIN" && body.role !== "SUPERADMIN"))) {
    return reply.code(400).send({ error: "you cannot deactivate or demote your own account" });
  }
  // when an admin flips a user inactive, capture who did it and why for the
  // Past users audit trail (self-service uses a separate endpoint that always
  // records "self")
  if (body.active === false) {
    body.revokedBy = admin.email;
    body.revokedReason = body.reason || body.revokedReason || "Deactivated by admin";
  }
  let updated;
  try { updated = await updateUser(req.params.id, body); }
  catch (e: any) { return reply.code(e?.code === "P2025" ? 404 : 400).send({ error: e?.code === "P2025" ? "user not found" : (e?.message || "could not update user") }); }
  const changedKeys = Object.keys(body).join(", ") || "no fields";
  logAdminAction(admin, "user.update", `Updated user ${req.params.id} (${changedKeys})`, { targetType: "User", targetId: req.params.id, detail: redactAuditDetail(body), impactCount: body.employerIds?.length ?? 1, context: requestSecurityContext(req) });
  return updated;
});
app.post<{ Params: { id: string }; Body: { password: string } }>("/api/users/:id/reset-password", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  try {
    const result = await resetPassword(req.params.id, String(req.body?.password ?? ""));
    logAdminAction(admin, "user.reset_password", `Reset password for user ${req.params.id}`, { targetType: "User", targetId: req.params.id, impactCount: 1, context: requestSecurityContext(req) });
    return result;
  } catch (e: any) { return reply.code(400).send({ error: e?.message || "could not reset password" }); }
});

// self-service: a signed-in user disables their own account (not a hard delete —
// an admin can still see it under Past users and reactivate it). Ends their
// session immediately, so the response redirects them straight to /login.
app.post<{ Body: { reason?: string } }>("/api/users/me/deactivate", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  await deactivateSelf(user.id, req.body?.reason);
  reply.clearCookie("session", { path: "/", httpOnly: true, sameSite: "lax", secure: COOKIE_SECURE });
  return { ok: true };
});

// admin-only: permanent delete. Requires the account to already be deactivated
// (defence in depth — nobody disappears without first going through revoke).
app.delete<{ Params: { id: string } }>("/api/users/:id", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  const target = await prisma.user.findUnique({ where: { id: req.params.id }, select: { role: true } });
  if (!target) return reply.code(404).send({ error: "user not found" });
  if (admin.role !== "SUPERADMIN" && target.role === "SUPERADMIN") return reply.code(404).send({ error: "user not found" });
  try {
    const result = await deleteUserPermanently(req.params.id);
    logAdminAction(admin, "user.delete", `Permanently deleted user ${req.params.id}`, { targetType: "User", targetId: req.params.id, impactCount: 1, context: requestSecurityContext(req) });
    return result;
  }
  catch (e: any) { return reply.code(400).send({ error: e.message }); }
});

// admin-only: "Past users" — everyone currently deactivated, with who revoked
// access and why, so admins can see who once had access and why it ended.
app.get("/api/admin/users/revoked", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  const users = await listRevokedUsers();
  // Keep privileged control-plane accounts invisible to ordinary admins.
  return admin.role === "SUPERADMIN" ? users : users.filter((u: any) => u.role !== "SUPERADMIN");
});

// ════════════════════ ENGAGEMENT ANALYTICS ════════════════════
// Any signed-in user can post their own pageview/scroll beacons. Kept
// intentionally lightweight — no third-party tracking, best-effort (never
// blocks the page if it fails).
app.post<{ Body: { type: "PAGEVIEW" | "SCROLL_DEPTH" | "SESSION_END" | "CTA_CLICK" | "FORM_SUBMIT" | "OUTBOUND_CLICK" | "CLIENT_ERROR"; path: string; value?: number } }>(
  "/api/analytics/event",
  async (req, reply) => {
    const user = await currentUser(req); // best-effort — allow anonymous beacons to no-op rather than 401 spam
    const b = req.body ?? ({} as any);
    const EVENT_TYPES = ["PAGEVIEW", "SCROLL_DEPTH", "SESSION_END", "CTA_CLICK", "FORM_SUBMIT", "OUTBOUND_CLICK", "CLIENT_ERROR"];
    if (!EVENT_TYPES.includes(b.type) || typeof b.path !== "string" || !b.path) return reply.code(400).send({ error: "valid type and path are required" });
    // Anonymous visitors may only record a pageview on the public marketing/legal pages;
    // everything else requires a signed-in session so the table can't be spammed.
    const PUBLIC_PATHS = ["/login", "/contact", "/thank-you", "/privacy", "/terms", "/cookies"];
    if (!user && !(b.type === "PAGEVIEW" && PUBLIC_PATHS.includes(b.path))) return { ok: true };
    try {
      await recordEvent({ userId: user?.id ?? null, type: b.type, path: b.path, value: b.value, partnerId: (user as any)?.partnerId ?? null });
      return { ok: true };
    } catch { return { ok: true }; } // never fail the page over analytics
  },
);
// admin-only: client reach — active users, logins, pageviews, scroll depth
app.get<{ Querystring: { days?: string } }>("/api/admin/analytics/summary", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const days = Math.min(180, Math.max(1, Number(req.query.days) || 30));
  return engagementSummary(days);
});

// ════════════════════ DASHBOARD SECTION PERMISSIONS (admin only) ════════════════════
// Controls which dashboard sections are visible, and to whom — used to hide a
// section that isn't finished yet (e.g. "Voice of the employee") and to grant
// specific people early access regardless of role.
app.get("/api/admin/sections", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const sections = await listSections();
  return sections.map((s: any) => ({
    key: s.key, label: s.label, enabled: s.enabled,
    allowedRoles: s.allowedRoles.split(",").map((r: string) => r.trim()),
    overrides: s.overrides.map((o: any) => ({ userId: o.userId, name: o.user.name, email: o.user.email })),
  }));
});
app.patch<{ Params: { key: string }; Body: { enabled?: boolean; allowedRoles?: string[] } }>(
  "/api/admin/sections/:key",
  async (req, reply) => {
    const admin = await requireAdmin(req, reply); if (!admin) return;
    try {
      const result = await updateSection(req.params.key, req.body || {});
      logAdminAction(admin, "section.update", "Updated section " + req.params.key, { targetType: "DashboardSection", targetId: req.params.key, detail: redactAuditDetail(req.body), impactCount: Array.isArray(req.body?.allowedRoles) ? req.body.allowedRoles.length : 1, context: requestSecurityContext(req) });
      return result;
    }
    catch (e: any) { return reply.code(400).send({ error: e?.message || "could not update section" }); }
  },
);
app.post<{ Params: { key: string }; Body: { userId: string } }>(
  "/api/admin/sections/:key/grant",
  async (req, reply) => {
    const admin = await requireAdmin(req, reply); if (!admin) return;
    if (!req.body?.userId) return reply.code(400).send({ error: "userId required" });
    const result = await grantUserSection(req.body.userId, req.params.key);
    logAdminAction(admin, "section.grant", "Granted section " + req.params.key + " to user " + req.body.userId, { targetType: "DashboardSection", targetId: req.params.key, impactCount: 1, context: requestSecurityContext(req) });
    return result;
  },
);
app.post<{ Params: { key: string }; Body: { userId: string } }>(
  "/api/admin/sections/:key/revoke",
  async (req, reply) => {
    const admin = await requireAdmin(req, reply); if (!admin) return;
    if (!req.body?.userId) return reply.code(400).send({ error: "userId required" });
    const result = await revokeUserSection(req.body.userId, req.params.key);
    logAdminAction(admin, "section.revoke", "Revoked section " + req.params.key + " from user " + req.body.userId, { targetType: "DashboardSection", targetId: req.body.userId, impactCount: 1, context: requestSecurityContext(req) });
    return result;
  },
);

// admin-only: audit log viewer
app.get<{ Querystring: { limit?: string } }>("/api/admin/audit-log", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return listAuditLog({ limit: Math.min(1000, Math.max(1, parseInt(req.query.limit ?? "", 10) || 200)) });
});
app.get("/api/admin/audit-log.csv", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  reply.header("Content-Type", "text/csv; charset=utf-8");
  reply.header("Content-Disposition", `attachment; filename="admin-audit-log-${new Date().toISOString().slice(0, 10)}.csv"`);
  return reply.send(await exportAuditLogCsv());
});

// ════════════════════ ADMIN MODULE ════════════════════

// list every report format + load order (admin UI renders from this)
app.get("/api/admin/reports", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return { loadOrder: LOAD_ORDER, reports: formatManifest(REPORT_FORMATS) };
});

// download a blank template (?fmt=csv|xlsx)
app.get<{ Params: { key: string }; Querystring: { fmt?: string } }>(
  "/api/admin/reports/:key/template",
  async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const format = getFormat(req.params.key);
    if (!format) return reply.code(404).send({ error: "unknown report" });
    if ((req.query.fmt ?? "csv") === "xlsx") {
      reply.header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      reply.header("Content-Disposition", `attachment; filename="${format.key}_template.xlsx"`);
      return reply.send(xlsxTemplate(format));
    }
    reply.header("Content-Type", "text/csv");
    reply.header("Content-Disposition", `attachment; filename="${format.key}_template.csv"`);
    return reply.send(csvTemplate(format));
  },
);

// upload a report file -> parse + validate -> staged batch (NOT yet live)
// Returns 202 immediately and validates in the background; the browser
// polls /api/admin/upload-jobs/:jobId (admin.html already does this — the
// route just needs to exist). Parsing/validating a large CSV/XLSX is CPU
// and DB work that can run for a while; doing it inline on the request
// blocked the whole HTTP connection (and the rest of the server) until it
// finished, which is what made uploads feel like they were hanging.
app.post<{ Params: { key: string } }>(
  "/api/admin/reports/:key/upload",
  async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    try {
      const file = await req.file();
      if (!file) return reply.code(400).send({ error: "no file uploaded" });
      const buffer = await file.toBuffer();
      const jobId = startUploadJob({
        reportKey: req.params.key,
        filename: file.filename,
        buffer,
        uploadedBy: (await currentUser(req))?.email ?? undefined,
      });
      return reply.code(202).send({ status: "ACCEPTED", jobId });
    } catch (e: any) {
      req.log.error(e);
      return reply.code(400).send({ error: `could not read the file: ${e.message}. Check it's a valid CSV/Excel and that text with commas is wrapped in quotes.` });
    }
  },
);

app.get<{ Params: { jobId: string } }>(
  "/api/admin/upload-jobs/:jobId",
  async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const job = getUploadJob(req.params.jobId);
    if (!job) return reply.code(404).send({ error: "unknown upload job" });
    if (job.status === "PENDING") return { status: "PROCESSING" };
    if (job.status === "FAILED") return { status: "FAILED", error: job.error };
    return { status: "DONE", ...job.result };
  },
);

// commit a validated batch -> writes live + recomputes affected snapshots
// Returns 202 immediately; the browser polls /api/admin/commit-jobs/:jobId.
app.post<{ Params: { batchId: string } }>(
  "/api/admin/batches/:batchId/commit",
  async (req, reply) => {
    const admin = await requireAdmin(req, reply); if (!admin) return;
    const batch = await prisma.importBatch.findUnique({
      where: { id: req.params.batchId },
      select: { rowCount: true, insertedCount: true, updatedCount: true, deletedCount: true, reportKey: true },
    });
    if (!batch) return reply.code(404).send({ error: "batch not found" });
    const impactCount = batch.rowCount || batch.insertedCount + batch.updatedCount + batch.deletedCount;
    const jobId = startCommitJob(req.params.batchId);
    logAdminAction(admin, "import.commit", "Committed import batch " + req.params.batchId + " (" + batch.reportKey + ")", {
      targetType: "ImportBatch", targetId: req.params.batchId, impactCount, context: requestSecurityContext(req),
      detail: { rowCount: batch.rowCount, insertedCount: batch.insertedCount, updatedCount: batch.updatedCount, deletedCount: batch.deletedCount },
    });
    return reply.code(202).send({ status: "ACCEPTED", jobId, batchId: req.params.batchId });
  },
);

app.get<{ Params: { jobId: string } }>(
  "/api/admin/commit-jobs/:jobId",
  async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const job = getCommitJob(req.params.jobId);
    if (!job) return reply.code(404).send({ error: "unknown commit job" });
    if (job.status === "PENDING") return { status: "PROCESSING" };
    if (job.status === "FAILED") return { status: "FAILED", error: job.error };
    return { status: "DONE", ...job.result };
  },
);

// revert a committed batch
app.post<{ Params: { batchId: string } }>(
  "/api/admin/batches/:batchId/revert",
  async (req, reply) => {
    const admin = await requireAdmin(req, reply); if (!admin) return;
    try {
      const batch = await prisma.importBatch.findUnique({ where: { id: req.params.batchId }, select: { rowCount: true } });
      const result = await revertBatch(req.params.batchId);
      logAdminAction(admin, "import.revert", "Reverted import batch " + req.params.batchId, {
        targetType: "ImportBatch", targetId: req.params.batchId, impactCount: batch?.rowCount || 1, context: requestSecurityContext(req),
      });
      return result;
    } catch (e: any) {
      req.log.warn({ err: e, batchId: req.params.batchId }, "import batch revert rejected");
      return reply.code(409).send({ error: e?.message || "This import cannot be safely reverted." });
    }
  },
);

// import history
app.get("/api/admin/batches", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const batches = await prisma.importBatch.findMany({
    orderBy: { uploadedAt: "desc" },
    take: 100,
    select: {
      id: true, reportKey: true, filename: true, fileFormat: true,
      status: true, rowCount: true, errorCount: true,
      insertedCount: true, updatedCount: true, deletedCount: true,
      uploadedAt: true, committedAt: true, revertedAt: true,
    },
  });
  return batches.map((batch) => {
    const insertOnly = batch.updatedCount === 0 && batch.deletedCount === 0;
    const reversibleReport = ["employers", "ratings", "referrals", "salary_advances"].includes(batch.reportKey);
    const revertable = batch.status === "COMMITTED" && insertOnly && reversibleReport;
    let revertReason = "";
    if (batch.status === "COMMITTED" && !revertable) {
      revertReason = !insertOnly
        ? "This import updated or deleted existing data and cannot be reversed without a prior-state snapshot."
        : "This feed is corrected by a newer source version/tombstone rather than physical rollback.";
    }
    return { ...batch, revertable, revertReason };
  });
});

// download the exact source rows uploaded for an import batch as CSV
app.get<{ Params: { batchId: string } }>("/api/admin/batches/:batchId/csv", async (req, reply) => {
    if (!(await requireAdmin(req, reply)))
        return;
    try {
        const batch = await prisma.importBatch.findUnique({
            where: { id: req.params.batchId },
            select: { id: true, reportKey: true },
        });
        if (!batch)
            return reply.code(404).send({ error: "import batch not found" });
        const csv = await exportImportBatchCsv(batch.id);
        const safeReport = String(batch.reportKey).replace(/[^a-zA-Z0-9_-]/g, "_");
        reply.header("Content-Type", "text/csv; charset=utf-8");
        reply.header("Content-Disposition", `attachment; filename="${safeReport}-uploaded-data.csv"`);
        return reply.send(csv);
    }
    catch (e: any) {
        req.log.error(e);
        return reply.code(400).send({ error: e?.message || "Could not export import data." });
    }
});
// ── DANGER: wipe ALL imported data (clean slate for go-live). Admin only,
//    and the body must contain confirm: "RESET" so it can't fire by accident. ──
app.post<{ Body: { confirm?: string } }>("/api/admin/reset-all", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  if ((req.body?.confirm) !== "RESET") {
    return reply.code(400).send({ error: 'confirmation phrase missing — expected confirm: "RESET"' });
  }
  try {
    const result = await resetAllData();
    logAdminAction(admin, "data.reset_all", `Wiped all imported data (clean slate)`, { detail: result });
    return result;
  } catch (e: any) {
    req.log.error({ err: e }, "reset all imported data failed");
    return reply.code(500).send({ error: e?.message || "Reset failed." });
  }
});

// ── External integration (API or direct SQL pull & sync) — admin only ──
app.get("/api/admin/integration", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const cfg = await getSyncConfig();
  // Secrets are never returned to the browser; only presence flags are exposed.
  return publicSyncConfig(cfg);
});

app.post<{ Body: {
  enabled?: boolean;
  sourceMode?: string;
  baseUrl?: string | null;
  authToken?: string | null;
  scheduleHours?: number;
  sqlDialect?: string | null;
  sqlHost?: string | null;
  sqlPort?: number | null;
  sqlDatabase?: string | null;
  sqlSchema?: string | null;
  sqlUsername?: string | null;
  sqlPassword?: string | null;
  sqlSsl?: boolean;
  sqlTrustServerCertificate?: boolean;
  sqlViewPrefix?: string | null;
  sqlQueryTimeoutMs?: number;
  sqlMaxRowsPerReport?: number;
  analyticsMode?: string;
  sourceAnalyticsEnabled?: boolean;
  sourceAnalyticsReadOnly?: boolean;
  sourceAnalyticsUseReplica?: boolean;
  sourceAnalyticsNote?: string | null;
  sourceAnalyticsReplicaEnabled?: boolean;
  sourceAnalyticsReplicaHost?: string | null;
  sourceAnalyticsReplicaPort?: number | null;
  sourceAnalyticsReplicaDatabase?: string | null;
  sourceAnalyticsReplicaSchema?: string | null;
  sourceAnalyticsReplicaUsername?: string | null;
  sourceAnalyticsReplicaPassword?: string | null;
  sourceAnalyticsReplicaSsl?: boolean;
  sourceAnalyticsReplicaTrustServerCertificate?: boolean;
  sourceAnalyticsReplicaMaxLagSeconds?: number;
} }>(
  "/api/admin/integration",
  async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const cfg = await saveSyncConfig(req.body || {});
    return publicSyncConfig(cfg);
  },
);

app.post<{ Body: Record<string, unknown> }>("/api/admin/integration/test", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return testSyncConnection((req.body || {}) as any);
});

// Trigger an integration sync (API or SQL). Returns 202 immediately; the
// browser polls /api/admin/sync-jobs/:jobId. Pulling and validating a full
// dataset from an external source can take minutes and must never hold the
// HTTP connection (and the admin UI) open until it finishes.
app.post("/api/admin/integration/sync", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const jobId = startSyncJob("manual");
  return reply.code(202).send({ status: "ACCEPTED", jobId });
});

app.get<{ Params: { jobId: string } }>(
  "/api/admin/sync-jobs/:jobId",
  async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const job = getSyncJob(req.params.jobId);
    if (!job) return reply.code(404).send({ error: "unknown sync job" });
    if (job.status === "PENDING") return { status: "PROCESSING" };
    if (job.status === "FAILED") return { status: "FAILED", error: job.error };
    return { status: "DONE", ...job.result };
  },
);

// Manual run of the scheduled daily live refresh (app pipeline by default;
// set DAILY_REFRESH_MODE=sqlproc to run refresh_all_reports() in the DB).
app.post("/api/admin/integration/refresh", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return triggerRefreshNow();
});

// ── DANGER: wipe every synced row and pull a fresh full copy from the
//    connected API/SQL source in one action. Cursor-based "Sync now" only
//    ever pulls what's changed since the last cursor, so rows the source
//    deleted (or a bad prior sync left half-committed) can linger forever.
//    This is the explicit "throw it all away and reload from scratch"
//    button for that — admin only, and confirm: "RESET" is required so it
//    can never fire from a stray click. ──
app.post<{ Body: { confirm?: string } }>("/api/admin/integration/full-resync", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  if ((req.body?.confirm) !== "RESET") {
    return reply.code(400).send({ error: 'confirmation phrase missing — expected confirm: "RESET"' });
  }
  try {
    const wiped = await resetAllData();
    logAdminAction(admin, "data.reset_all", `Wiped all imported data (full resync)`, { detail: wiped });
    const synced = await runSync("manual");
    return { wiped, synced };
  } catch (e: any) {
    req.log.error({ err: e }, "full resync failed");
    return reply.code(500).send({ error: e?.message || "Full resync failed." });
  }
});

app.get("/api/admin/integration/replica-health", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  try {
    const cfg = await getSyncConfig();
    return await checkMysqlReadReplica(cfg);
  } catch (e: any) {
    return reply.code(400).send({ configured: false, reachable: false, error: e?.message || "Could not check source replica." });
  }
});

app.get("/api/admin/integration/logs", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return recentSyncLogs(10);
});

// ── Enterprise operations and analytics placement ──
app.get("/api/admin/enterprise/overview", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return enterpriseOperationsOverview();
});
app.get("/api/admin/enterprise/data-quality", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return dataQualityOverview();
});
app.get("/api/admin/integration/routes", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return listAnalyticsRoutes();
});
app.post<{ Body: { reportKey?: string; executionMode?: string; workloadClass?: string; sourceView?: string | null; useReplica?: boolean; enabled?: boolean; rationale?: string | null } }>("/api/admin/integration/routes", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  try {
    const result = await saveAnalyticsRoute({ reportKey: String(req.body?.reportKey || ""), executionMode: String(req.body?.executionMode || "POSTGRES"), sourceView: req.body?.sourceView, enabled: req.body?.enabled, rationale: req.body?.rationale });
    logAdminAction(admin, "integration.route_update", `Updated analytics route for ${result.reportKey} to ${result.executionMode}`, { targetType: "AnalyticsRoute", targetId: result.id });
    return result;
  } catch (e: any) { return reply.code(400).send({ error: e?.message || "Could not save analytics route." }); }
});


// ── system email / SMTP settings — admin only ──
app.get("/api/admin/email-settings", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return publicEmailConfig();
});
app.post<{ Body: any }>("/api/admin/email-settings", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  try {
    const result = await saveEmailConfig(req.body || {});
    const keys = Object.keys(req.body || {}).filter((k) => k !== "smtpPassword").join(", ") || "no fields";
    logAdminAction(admin, "email_settings.update", `Updated email/automation settings (${keys})`, { targetType: "SystemEmailConfig" });
    return result;
  }
  catch (e: any) { return reply.code(400).send({ error: e?.message || "Could not save email settings" }); }
});
app.post<{ Body: any }>("/api/admin/email-settings/test", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  try { return await testEmailConnection(req.body || {}); }
  catch (e: any) { return reply.code(400).send({ error: e?.message || "Email test failed" }); }
});
// manual "run now" for automations — lets an admin verify config without waiting for the hourly tick
app.post<{ Body: { kind: "stale" | "digest" | "test" } }>("/api/admin/automations/run", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  try {
    const kind = req.body?.kind;
    if (kind === "stale") {
      const r = await runStaleAccountCheck();
      return { ok: true, message: r.ran ? `Checked — ${r.deactivated ?? 0} account(s) auto-deactivated.` : "Not run: no inactivity threshold is set." };
    }
    if (kind === "digest") {
      const r = await runWeeklyDigestIfDue();
      return { ok: true, message: r.ran ? "Digest sent." : "Not sent: digest is disabled, or one was already sent in the last 7 days." };
    }
    if (kind === "test") {
      const r = await notifyAdmins({ subject: "Test alert from empower-fin Dashboard Portal", html: `<p>This is a test alert triggered by ${admin.name} (${admin.email}).</p>`, slackText: `:wave: Test alert triggered by ${admin.name}.` });
      return { ok: true, message: `Sent to ${r.emailed} email address(es)${r.slack ? " and Slack" : ""}. Set admin alert emails and/or a Slack webhook first if nothing arrived.` };
    }
    return reply.code(400).send({ error: "Unknown automation kind" });
  } catch (e: any) { return reply.code(400).send({ error: e?.message || "Could not run automation" }); }
});
app.get("/api/admin/report-deliveries", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return recentReportDeliveries(30);
});
app.get("/api/admin/report-schedules", async (req, reply) => {
  const user = await requireAdmin(req, reply); if (!user) return;
  return listReportSchedules(user, true);
});

// ── scheduled employer reports — available to signed-in dashboard users ──
app.get("/api/report-schedules/config", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const cfg = await publicEmailConfig();
  return { configured: cfg.configured, defaultTimezone: cfg.defaultTimezone };
});
app.get("/api/report-schedules", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  return listReportSchedules(user, false);
});
app.post<{ Body: ScheduleInput }>("/api/report-schedules", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  try { return await createReportSchedule(user, req.body); }
  catch (e: any) { return reply.code(400).send({ error: e?.message || "Could not create report schedule" }); }
});
app.patch<{ Params: { id: string }; Body: any }>("/api/report-schedules/:id", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  try { return await updateReportSchedule(user, req.params.id, req.body || {}); }
  catch (e: any) { return reply.code(400).send({ error: e?.message || "Could not update report schedule" }); }
});
app.delete<{ Params: { id: string } }>("/api/report-schedules/:id", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  try { return await deleteReportSchedule(user, req.params.id); }
  catch (e: any) { return reply.code(400).send({ error: e?.message || "Could not delete report schedule" }); }
});
app.post<{ Params: { id: string } }>("/api/report-schedules/:id/send-now", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  try { return await sendReportNow(user, req.params.id); }
  catch (e: any) { return reply.code(400).send({ error: e?.message || "Could not send report" }); }
});

// ── channel partners (white-label) — admin only ──
// ── MLOps governance — admin only ──
app.get<{ Params: { employerId: string } }>("/api/admin/mlops/assessment/:employerId", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  try { return await runMLOpsAssessment(req.params.employerId); }
  catch (e:any) { return reply.code(400).send({ error:e?.message||"MLOps assessment failed" }); }
});
app.get("/api/admin/mlops/models", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return listMLOpsModels();
});
app.post<{Body:{modelKey:string;version:string;modelType:string;trainingVersion?:string;metrics?:any;featureSchema?:any}}>("/api/admin/mlops/models", async (req, reply) => {
  const admin=await requireAdmin(req, reply); if(!admin) return;
  try {
    const result=await registerMLOpsModel(req.body);
    logAdminAction(admin,"mlops.model_register",`Registered ${req.body.modelKey} ${req.body.version}`,{targetType:"MLOpsModel",targetId:result.id});
    return result;
  } catch(e:any) { return reply.code(400).send({error:e?.message||"Could not register model"}); }
});
app.post<{Params:{modelKey:string;version:string}}>("/api/admin/mlops/models/:modelKey/:version/promote", async (req, reply) => {
  const admin=await requireAdmin(req, reply); if(!admin) return;
  try {
    const result=await promoteMLOpsModel(req.params.modelKey,req.params.version);
    logAdminAction(admin,"mlops.model_promote",`Promoted ${req.params.modelKey} ${req.params.version}`,{targetType:"MLOpsModel",targetId:result?.id});
    return result;
  } catch(e:any) { return reply.code(400).send({error:e?.message||"Could not promote model"}); }
});
app.post<{Params:{modelKey:string;version:string}}>("/api/admin/mlops/models/:modelKey/:version/rollback", async (req, reply) => {
  const admin=await requireAdmin(req, reply); if(!admin) return;
  try {
    const result=await rollbackMLOpsModel(req.params.modelKey,req.params.version);
    logAdminAction(admin,"mlops.model_rollback",`Rolled back ${req.params.modelKey} ${req.params.version}`,{targetType:"MLOpsModel",targetId:result.id});
    return result;
  } catch(e:any) { return reply.code(400).send({error:e?.message||"Could not roll back model"}); }
});
app.get<{Querystring:{modelKey?:string;limit?:string}}>("/api/admin/mlops/events", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return listMLOpsEvents(req.query.modelKey,Number(req.query.limit||100));
});
app.post<{Body:{modelKey:string;eventId?:string;employerId?:string;feedback:"CORRECT"|"INCORRECT"|"REVIEWED";actualValue?:number;notes?:string}}>("/api/admin/mlops/feedback", async (req, reply) => {
  const admin=await requireAdmin(req, reply); if(!admin) return;
  try {
    const result=await recordMLOpsFeedback(req.body);
    logAdminAction(admin,"mlops.feedback",`Recorded ${req.body.feedback} feedback for ${req.body.modelKey}`,{targetType:"MLOpsEvent",targetId:result.feedbackId});
    return result;
  } catch(e:any) { return reply.code(400).send({error:e?.message||"Could not record feedback"}); }
});

app.get("/api/admin/partners", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return listPartners();
});

app.get("/api/admin/brand-learning/profile", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  return getBrandLearningProfile();
});

app.post<{ Body: { engineVersion?: string; palette?: any[]; confidence?: number; accepted?: boolean } }>("/api/admin/brand-learning/observe", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const b=req.body||{};
  return learnFromBrandUpload({engineVersion:String(b.engineVersion||"1.1.0"), palette:Array.isArray(b.palette)?b.palette:[], confidence:Number(b.confidence||0), accepted:Boolean(b.accepted)});
});

app.post<{ Body: { engineVersion?: string; palette?: any[] } }>("/api/admin/brand-learning/correction", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const b=req.body||{};
  return recordBrandCorrection({engineVersion:String(b.engineVersion||"1.1.0"), palette:Array.isArray(b.palette)?b.palette:[]});
});

app.get("/api/admin/brand-recognition/overview", async (req, reply) => {
  if (!(await requireAdmin(req, reply))) return;
  const rows = await prisma.partner.findMany({
    where: { brandDetectionConfidence: { not: null } },
    select: { brandDetectionStatus: true, brandDetectionConfidence: true, brandEngineVersion: true },
  });
  const confidence = rows.map((r: any) => Number(r.brandDetectionConfidence)).filter(Number.isFinite);
  const averageConfidence = confidence.length ? confidence.reduce((a: number, b: number) => a + b, 0) / confidence.length : null;
  return {
    engineVersion: rows.map((r: any) => r.brandEngineVersion).filter(Boolean).sort().pop() || "1.1.0",
    totalAnalysed: rows.length,
    autoAccepted: rows.filter((r: any) => r.brandDetectionStatus === "AUTO_ACCEPTED").length,
    needsReview: rows.filter((r: any) => r.brandDetectionStatus === "NEEDS_REVIEW").length,
    manual: rows.filter((r: any) => r.brandDetectionStatus === "MANUAL").length,
    averageConfidence: averageConfidence == null ? null : Math.round(averageConfidence * 100) / 100,
    lowConfidence: confidence.filter((v: number) => v < 0.45).length,
  };
});
app.post<{ Body: { name: string; displayName?: string } }>("/api/admin/partners", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  if (typeof req.body?.name !== "string" || !req.body.name.trim()) return reply.code(400).send({ error: "partner name required" });
  let created;
  try { created = await createPartner(req.body); }
  catch (e: any) { return reply.code(400).send({ error: e?.message || "could not create partner" }); }
  logAdminAction(admin, "partner.create", `Created channel partner "${req.body.name}"`, { targetType: "Partner", targetId: (created as any)?.id });
  return created;
});
app.put<{ Params: { id: string }; Body: any }>("/api/admin/partners/:id", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  let updated;
  try { updated = await updatePartner(req.params.id, req.body || {}); }
  catch (e: any) { return reply.code(e?.code === "P2025" ? 404 : 400).send({ error: e?.code === "P2025" ? "partner not found" : (e?.message || "could not update partner") }); }
  const keys = Object.keys(req.body || {}).join(", ") || "no fields";
  logAdminAction(admin, "partner.update", `Updated channel partner ${req.params.id} (${keys})`, { targetType: "Partner", targetId: req.params.id });
  return updated;
});
app.delete<{ Params: { id: string } }>("/api/admin/partners/:id", async (req, reply) => {
  const admin = await requireAdmin(req, reply); if (!admin) return;
  const result = await deletePartner(req.params.id);
  logAdminAction(admin, "partner.delete", `Deleted channel partner ${req.params.id}`, { targetType: "Partner", targetId: req.params.id });
  return result;
});
app.post<{ Params: { id: string }; Body: { userId?: string; employerId?: string } }>(
  "/api/admin/partners/:id/assign",
  async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    if (req.body?.userId) return assignUserToPartner(req.body.userId, req.params.id);
    if (req.body?.employerId) return assignEmployerToPartner(req.body.employerId, req.params.id);
    return reply.code(400).send({ error: "userId or employerId required" });
  },
);
// public: theme by slug (for the future branded login page)
app.get<{ Params: { slug: string } }>("/api/partner-theme/:slug", async (req) => {
  return themeForSlug(req.params.slug);
});

// ── dashboard: real stock/as-at + flow/in-window filtering ──
app.get<{
  Params: { employerId: string };
  Querystring: { period?: string; quarter?: string; range?: "30d" | "quarter" | "all" | "month" | "30" | "q" | "latest"; site?: string; income?: string };
}>(
  "/api/employers/:employerId/dashboard",
  async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const { employerId } = req.params;
    if (!canViewEmployer(user, employerId)) return reply.code(403).send({ error: "no access to this employer" });
    const queryError = dashboardQueryError(req.query);
    if (queryError) return reply.code(400).send({ error: queryError });
    const payload: any = await getDashboardPayload(employerId, {
      period: req.query.period,
      quarter: req.query.quarter,
      range: req.query.range,
      site: req.query.site,
      income: req.query.income,
    });
    const sections = await sectionsForUser(user);
    if (!sections.voiceOfEmployee) payload.chat = { available: false };
    return payload;
  },
);

// ── available months (periods) for the month picker, scoped to access ──
app.get<{ Params: { employerId: string }; Querystring: { site?: string; income?: string } }>(
  "/api/employers/:employerId/periods",
  async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!canViewEmployer(user, req.params.employerId)) return reply.code(403).send({ error: "no access" });

    // Keep this endpoint cheap. The previous implementation read date columns
    // from six large tables and then ran the full dashboard builder once per
    // month. With 100k employees that creates a huge N+1 workload before the
    // user has even opened the month selector.
    //
    // Persisted monthly scores are the fast path. Region/Income is applied by
    // the dashboard request after a period is selected; the period picker must
    // never calculate twelve full cohort dashboards.
    const employerId = req.params.employerId;
    // The period picker is a dimension selector, not a dashboard calculator.
    // Never rebuild the full dashboard once per month just to populate it.

    const snapshots = await prisma.scoreSnapshot.findMany({
      where: { employerId, payloadVersion: { gte: 4 } },
      select: {
        period: true,
        optimiseScore: true,
        rawScore: true,
        engagementScore: true,
        cashflowScore: true,
        debtRiskScore: true,
        insuranceScore: true,
        engagementWeight: true,
        cashflowWeight: true,
        debtRiskWeight: true,
        insuranceWeight: true,
      },
      orderBy: { period: "desc" },
    });

    const periodSet = new Set(snapshots.map((s: any) => s.period));

    // ScoreSnapshot is the preferred source for labelled scores, but it is not
    // guaranteed to exist for every month covered by imported workforce data.
    // Build the period dimension from the immutable EmployeeVersion observation
    // table as well. PostgreSQL does the DISTINCT/month extraction; never pull
    // 100k employee rows into Node just to populate a selector.
    const observedPeriods = await prisma.$queryRaw<Array<{ period: string }>>(Prisma.sql`
      SELECT DISTINCT to_char(date_trunc('month', ev."observedAt"), 'YYYY-MM') AS period
      FROM "EmployeeVersion" ev
      INNER JOIN "Employee" e ON e.id = ev."employeeId"
      WHERE e."employerId" = ${employerId}
        AND e."sourceDeletedAt" IS NULL
        AND ev."isDeleted" = false
      ORDER BY period DESC
      LIMIT 24
    `);
    for (const row of observedPeriods) {
      if (row?.period) periodSet.add(row.period);
    }

    const latestEmployee = await prisma.employee.findFirst({
      where: { employerId, sourceDeletedAt: null },
      select: { observedAt: true },
      orderBy: { observedAt: "desc" },
    });
    if (latestEmployee?.observedAt) periodSet.add(monthKey(latestEmployee.observedAt));

    // Return at most the latest 12 real reporting months. Keep the selector
    // cheap: only the indexed observation dimension and persisted snapshots are
    // touched; never invoke getDashboardPayload from this endpoint.
    const latestPeriods = [...periodSet].sort().reverse().slice(0, 12);
    const snapshotByPeriod = new Map(snapshots.map((row: any) => [row.period, row]));
    const snapshotScore = (snap: any): number | null => {
      if (!snap) return null;
      const stored = Number(snap.optimiseScore);
      // Older/broken snapshots have occasionally contained a zero headline
      // while the four driver scores were populated. Rebuild the headline
      // from the persisted driver scores instead of exposing a false 0.
      const drivers = [
        [Number(snap.engagementScore), Number(snap.engagementWeight)],
        [Number(snap.cashflowScore), Number(snap.cashflowWeight)],
        [Number(snap.debtRiskScore), Number(snap.debtRiskWeight)],
        [Number(snap.insuranceScore), Number(snap.insuranceWeight)],
      ];
      const weighted = drivers.every(([score, weight]) => Number.isFinite(score) && Number.isFinite(weight) && weight > 0)
        ? Math.round(drivers.reduce((sum, [score, weight]) => sum + score * weight, 0))
        : null;
      if (stored > 0 && stored <= 100) return Math.round(stored);
      if (weighted != null && weighted >= 0 && weighted <= 100) return weighted;
      const raw = Number(snap.rawScore);
      return Number.isFinite(raw) ? Math.max(0, Math.min(100, Math.round(raw))) : null;
    };

    const results = latestPeriods.map(period => {
      const snap: any = snapshotByPeriod.get(period);
      return { period, optimiseScore: snapshotScore(snap) };
    });

    // Most months already have a usable persisted snapshot (the fast path
    // above). But a period can legitimately have none yet — data just
    // imported for it, the snapshot job hasn't run, or the row is stuck at
    // an old payloadVersion until scripts/rebuild-score-snapshots.ts is
    // re-run — and in that case the picker was showing "Score unavailable"
    // forever instead of a number. Rather than silently leaving those
    // periods blank, compute the handful that are missing on demand — this
    // reuses the same cached dashboard-payload path getDashboardPayload
    // already uses everywhere else, so it's cheap after the first request
    // and never touches the months that already resolved above.
    const missing = results.filter(r => r.optimiseScore == null);
    if (missing.length) {
      await Promise.all(missing.map(async (r) => {
        try {
          const live: any = await getDashboardPayload(employerId, { period: r.period });
          if (live?.wellness?.complete && live?.wellness?.score != null) {
            r.optimiseScore = Math.round(Number(live.wellness.score));
          }
        } catch { /* leave unavailable — the picker still shows the period itself */ }
      }));
    }

    return results;
  },
);

// ── score history (movement chart) — scoped ──
app.get<{ Params: { employerId: string } }>(
  "/api/employers/:employerId/score-history",
  async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!canViewEmployer(user, req.params.employerId)) return reply.code(403).send({ error: "no access to this employer" });
    const snaps = await prisma.scoreSnapshot.findMany({
      where: { employerId: req.params.employerId },
      orderBy: { period: "asc" },
      select: {
        period: true,
        optimiseScore: true,
        engagementScore: true,
        cashflowScore: true,
        debtRiskScore: true,
        insuranceScore: true,
        payloadVersion: true,
      },
    });

    const history = [];
    for (const snap of snaps) {
      if (snap.payloadVersion >= 4 && snap.optimiseScore != null) {
        history.push({
          period: snap.period,
          optimiseScore: snap.optimiseScore,
          engagementScore: snap.engagementScore,
          cashflowScore: snap.cashflowScore,
          debtRiskScore: snap.debtRiskScore,
          insuranceScore: snap.insuranceScore,
        });
        continue;
      }
      const live = await getDashboardPayload(req.params.employerId, { period: snap.period });
      history.push({
        period: snap.period,
        optimiseScore: live?.wellness?.complete && live?.wellness?.score != null ? Number(live.wellness.score) : null,
        engagementScore: live?.wellness?.drivers?.[0]?.score ?? null,
        cashflowScore: live?.wellness?.drivers?.[1]?.score ?? null,
        debtRiskScore: live?.wellness?.drivers?.[2]?.score ?? null,
        insuranceScore: live?.wellness?.drivers?.[3]?.score ?? null,
      });
    }
    return history;
  },
);


// ── trigger a (re)snapshot — admin only ──
app.post<{ Params: { employerId: string }; Body: { period: string } }>(
  "/api/employers/:employerId/snapshot",
  async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const period = req.body?.period;
    if (typeof period !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return reply.code(400).send({ error: "period must be YYYY-MM" });
    const result = await snapshotEmployer(req.params.employerId, period);
    if (result.persisted) notifyScoreChangeIfCurrentPeriod(req.params.employerId, result.period, currentPeriod()).catch(() => {});
    return result;
  },
);

// ── first-run: create an admin from env vars if no users exist ──
async function bootstrapAdmin() {
  try {
    const count = await prisma.user.count();
    if (count > 0) return;
    const email = process.env.ADMIN_EMAIL, password = process.env.ADMIN_PASSWORD;
    if (!email || !password) {
      app.log.warn("No users yet and ADMIN_EMAIL/ADMIN_PASSWORD not set — set them to create the first admin.");
      return;
    }
    if (password.length < 12 || !/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
      app.log.error("ADMIN_PASSWORD does not meet the password policy (12+ chars with upper, lower, digit); admin not created.");
      return;
    }
    const { hashPassword } = await import("./services/authService.js");
    await prisma.user.create({ data: { email: email.toLowerCase(), name: "Administrator", role: "ADMIN", passwordHash: hashPassword(password) } });
    app.log.info(`Bootstrapped first admin: ${email}`);
  } catch (e) { app.log.error(e); }
}

// ── scheduled-sync checker: every 15 min, run a sync if one is due ──
function startSyncScheduler(app: any) {
  const CHECK_MS = 15 * 60 * 1000;
  const tick = async () => {
    try {
      const cfg = await getSyncConfig();
      if (!cfg.enabled) return;
      const dueAfter = cfg.lastSyncAt ? new Date(cfg.lastSyncAt).getTime() + cfg.scheduleHours * 3600 * 1000 : 0;
      if (Date.now() >= dueAfter) {
        app.log.info("Running scheduled external source sync…");
        const r = await runSync("scheduled");
        app.log.info(`Scheduled sync: ${r.status ?? "done"}`);
        if (r.status === "FAILED") {
          notifyAdmins({
            subject: "Scheduled data sync failed",
            html: `<div style="font-family:Arial,sans-serif;color:#241536"><h2 style="color:#b5391f">Sync failed</h2><p>The scheduled external data sync failed.</p><pre style="background:#f7fafd;padding:12px;border-radius:8px;font-size:12px;overflow:auto">${JSON.stringify(r.summary ?? r, null, 2).slice(0, 2000)}</pre></div>`,
            slackText: `:rotating_light: Scheduled data sync failed — check Administration → Live Data Integration.`,
          }).catch(() => {});
        }
      }
    } catch (e) { app.log.error(e); }
  };
  setInterval(tick, CHECK_MS);
  setTimeout(tick, 30000); // also check shortly after boot
}


// ── automations checker: stale-account cleanup + weekly digest ──
function startAutomationScheduler(app: any) {
  const CHECK_MS = 60 * 60 * 1000; // hourly is plenty — both checks are self-gated by date thresholds
  const tick = async () => {
    try { await runStaleAccountCheck(); } catch (e) { app.log.error(e); }
    try { await runWeeklyDigestIfDue(); } catch (e) { app.log.error(e); }
  };
  setInterval(tick, CHECK_MS);
  setTimeout(tick, 45000);
}

// ── scheduled-report checker: claims due jobs in the database and sends them via SMTP ──
function startReportScheduler(app: any) {
  const CHECK_MS = 60 * 1000;
  const tick = async () => {
    try { await runDueReports(app.log); }
    catch (e) { app.log.error(e); }
  };
  setInterval(tick, CHECK_MS);
  setTimeout(tick, 20000);
}

// ── portfolio view: same dated calculation model as each employer dashboard ──
app.get<{ Querystring: { period?: string; quarter?: string; range?: "30d" | "quarter" | "all" | "month" | "30" | "q" | "latest" } }>(
  "/api/portfolio",
  async (req, reply) => {
    const user = await requireUser(req, reply); if (!user) return;
    if (!canAccessModule(user, "portfolio")) return reply.code(403).send({ error: "no portfolio access" });
    const queryError = dashboardQueryError(req.query);
    if (queryError) return reply.code(400).send({ error: queryError });
    const ids = allowedEmployerIds(user);
    const employers = await prisma.employer.findMany({
      where: ids === null ? { sourceDeletedAt: null } : { id: { in: ids }, sourceDeletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    const out = [];
    let filterContext: unknown = null;
    for (const employer of employers) {
      const payload: any = await getDashboardPayload(employer.id, req.query);
      filterContext ??= payload.filterContext;
      out.push({ id: employer.id, name: employer.name, heads: payload.headcount, ...payload.portfolio });
    }
    return { employers: out, filterContext, generatedAt: new Date().toISOString() };
  },
);

// ── convenience: live dashboard of the first employer THIS USER can see ──
app.get("/api/dashboard/version", async (req, reply) => {
  const user = await requireUser(req, reply); if (!user) return;
  const latest = await prisma.integrationCursor.aggregate({ _max: { lastSuccessAt: true } });
  return { version: latest._max.lastSuccessAt?.toISOString() ?? null };
});

app.get<{ Querystring: { period?: string; quarter?: string; range?: "30d" | "quarter" | "all" | "month" | "30" | "q" | "latest"; site?: string; income?: string } }>(
  "/api/dashboard/first",
  async (req, reply) => {
    const user = await requireUser(req, reply);
    if (!user) return;
    const queryError = dashboardQueryError(req.query);
    if (queryError) return reply.code(400).send({ error: queryError });
    const ids = allowedEmployerIds(user);
    const employer = await prisma.employer.findFirst({
      where: ids === null ? { sourceDeletedAt: null } : { id: { in: ids }, sourceDeletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true },
    });
    if (!employer) return reply.code(404).send({ error: "no employer data available" });
    const payload: any = await getDashboardPayload(employer.id, req.query);
    const sections = await sectionsForUser(user);
    if (!sections.voiceOfEmployee) payload.chat = { available: false };
    return payload;
  },
);

process.on("unhandledRejection", (reason) => app.log.error({ err: reason }, "unhandled promise rejection"));
for (const sig of ["SIGTERM", "SIGINT"] as const) {
  process.once(sig, () => {
    app.log.info({ sig }, "shutting down");
    const force = setTimeout(() => process.exit(1), 25_000); force.unref();
    app.close().then(() => prisma.$disconnect()).finally(() => process.exit(0));
  });
}
// Close expired sessions for history, then prune only old ended records.
setInterval(() => {
  const now = new Date();
  const cutoff = new Date(Date.now() - 180 * 864e5);
  prisma.session.updateMany({ where: { expiresAt: { lt: now }, endedAt: null }, data: { endedAt: now } })
    .then(() => prisma.session.deleteMany({ where: { endedAt: { lt: cutoff } } }))
    .catch(() => {});
}, 60 * 60_000).unref();

// Register all routes before opening the listener.
  if (!CONTACT_EMAIL) app.log.warn("CONTACT_EMAIL is not set: the contact form is disabled and legal pages show a placeholder contact.");
  app.log.info({ portalVersion: "0.10.0", publicDir: PUBLIC_DIR }, "starting empower-fin Dashboard Portal");
app.listen({ port: PORT, host: "0.0.0.0" })
  .then(async () => { await bootstrapAdmin(); await ensureSectionDefaults(); startSyncScheduler(app); startReportScheduler(app);
startDailyRefresh(); startAutomationScheduler(app); app.log.info(`empower-fin Dashboard Portal on :${PORT}`); })
  .catch((err) => { app.log.error(err); process.exit(1); });
