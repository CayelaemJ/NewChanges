import { Prisma } from "@prisma/client";
import { prisma } from "./authService.js";

export interface RequestSecurityContext {
  ipAddress?: string;
  userAgent?: string;
  deviceType?: string;
  browser?: string;
  operatingSystem?: string;
  country?: string;
  region?: string;
  city?: string;
}

const trim = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) || undefined : undefined;

export function requestSecurityContext(input: any): RequestSecurityContext {
  const headers = input?.headers ?? {};
  const userAgent = trim(headers["user-agent"], 600);
  const deviceType = trim(headers["x-device-type"], 32);
  const browser = trim(headers["x-browser"], 64);
  const operatingSystem = trim(headers["x-operating-system"], 64);
  const first = (v: unknown) => typeof v === "string" ? v.split(",")[0]?.trim() : undefined;
  const ipAddress = trim(input?.ip ?? first(headers["x-forwarded-for"]) ?? first(headers["x-real-ip"]), 64);
  const country = trim(headers["cf-ipcountry"] ?? headers["x-vercel-ip-country"] ?? headers["x-country-code"] ?? headers["x-geo-country"], 80);
  const region = trim(headers["x-vercel-ip-country-region"] ?? headers["x-geo-region"], 120);
  const city = trim(headers["x-vercel-ip-city"] ?? headers["x-geo-city"], 120);
  const ua = parseUserAgent(userAgent);
  return {
    ipAddress,
    userAgent,
    deviceType: deviceType ?? ua.deviceType,
    browser: browser ?? ua.browser,
    operatingSystem: operatingSystem ?? ua.operatingSystem,
    country,
    region,
    city,
  };
}

function parseUserAgent(ua?: string) {
  if (!ua) return { deviceType: "Unknown", browser: "Unknown", operatingSystem: "Unknown" };
  const deviceType = /tablet|ipad/i.test(ua) ? "Tablet" : /mobile|iphone|android/i.test(ua) ? "Mobile" : "Desktop";
  const browser = /edg\//i.test(ua) ? "Edge" :
    /opr\//i.test(ua) ? "Opera" :
    /chrome\//i.test(ua) ? "Chrome" :
    /firefox\//i.test(ua) ? "Firefox" :
    /safari\//i.test(ua) && !/chrome|chromium/i.test(ua) ? "Safari" : "Other";
  const operatingSystem = /windows/i.test(ua) ? "Windows" :
    /android/i.test(ua) ? "Android" :
    /iphone|ipad|ios/i.test(ua) ? "iOS" :
    /mac os x/i.test(ua) ? "macOS" :
    /linux/i.test(ua) ? "Linux" : "Other";
  return { deviceType, browser, operatingSystem };
}

export async function recordLoginEvent(input: {
  userId?: string | null;
  email: string;
  success: boolean;
  failureReason?: string;
  context: RequestSecurityContext;
}) {
  try {
    await prisma.loginEvent.create({
      data: {
        userId: input.userId ?? undefined,
        email: input.email.toLowerCase().slice(0, 254),
        success: input.success,
        failureReason: input.failureReason?.slice(0, 200),
        ...input.context,
      },
    });
  } catch {
    // Security telemetry must never block authentication.
  }
}

export function classifyAdminRisk(action: string, impactCount?: number) {
  const count = Number(impactCount ?? 0);
  if (/delete|reset|revoke/i.test(action) && count >= 25) return "CRITICAL";
  if (/bulk|import|commit|user\.update|section\.grant|section\.revoke/i.test(action) && count >= 50) return "CRITICAL";
  if (/user\.create|user\.update|user\.delete|partner\.delete|reset/i.test(action)) return "HIGH";
  if (/import|commit|section\.|partner\./i.test(action) && count >= 10) return "HIGH";
  return "NORMAL";
}

export async function securityOverview() {
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const since7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const [sessions, failedLogins, successfulLogins, openAlerts, recentHighImpact, activeUsers] = await Promise.all([
    prisma.session.count({ where: { endedAt: null, expiresAt: { gt: now } } }),
    prisma.loginEvent.count({ where: { success: false, createdAt: { gte: since24h } } }),
    prisma.loginEvent.count({ where: { success: true, createdAt: { gte: since24h } } }),
    prisma.securityAlert.count({ where: { status: "OPEN" } }),
    prisma.adminAuditLog.findMany({ where: { flagged: true, createdAt: { gte: since7d } }, orderBy: { createdAt: "desc" }, take: 10 }),
    prisma.session.findMany({
      where: { endedAt: null, expiresAt: { gt: now } },
      include: { user: { select: { id: true, name: true, email: true, role: true } } },
      orderBy: { lastSeenAt: "desc" },
      take: 12,
    }),
  ]);
  const riskState = openAlerts > 0 ? "Attention" : failedLogins >= 10 ? "Watch" : "Good";
  return {
    riskState,
    activeSessions: sessions,
    failedLogins24h: failedLogins,
    successfulLogins24h: successfulLogins,
    openAlerts,
    activeUsers: activeUsers.map(s => ({ ...s, durationSeconds: Math.max(0, Math.floor((now.getTime() - s.createdAt.getTime()) / 1000)) })),
    recentHighImpact,
  };
}

export async function listSessions(opts: { userId?: string; status?: string; limit?: number } = {}) {
  const now = new Date();
  const limit = Math.min(250, Math.max(1, opts.limit ?? 100));
  const where: Prisma.SessionWhereInput = {
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(opts.status === "active" ? { endedAt: null, expiresAt: { gt: now } } : {}),
    ...(opts.status === "ended" ? { endedAt: { not: null } } : {}),
  };
  const rows = await prisma.session.findMany({
    where,
    include: { user: { select: { id: true, name: true, email: true, role: true, active: true } } },
    orderBy: { lastSeenAt: "desc" },
    take: limit,
  });
  return rows.map((s: any) => ({
    id: s.id,
    user: s.user,
    createdAt: s.createdAt,
    lastSeenAt: s.lastSeenAt,
    endedAt: s.endedAt,
    expiresAt: s.expiresAt,
    active: !s.endedAt && s.expiresAt > now && s.user.active,
    durationSeconds: Math.max(0, Math.floor(((s.endedAt ?? now).getTime() - s.createdAt.getTime()) / 1000)),
    ipAddress: s.ipAddress,
    deviceType: s.deviceType ?? "Unknown",
    browser: s.browser ?? "Unknown",
    operatingSystem: s.operatingSystem ?? "Unknown",
    location: [s.city, s.region, s.country].filter(Boolean).join(", ") || "Location unavailable",
  }));
}

export async function listLoginEvents(opts: { userId?: string; email?: string; limit?: number } = {}) {
  const rows = await prisma.loginEvent.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.email ? { email: opts.email.toLowerCase() } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, opts.limit ?? 200)),
  });
  return rows;
}

export async function listSecurityAlerts(opts: { status?: string; limit?: number } = {}) {
  return prisma.securityAlert.findMany({
    where: opts.status ? { status: opts.status } : undefined,
    orderBy: { createdAt: "desc" },
    take: Math.min(250, Math.max(1, opts.limit ?? 100)),
  });
}

export async function resolveSecurityAlert(id: string, adminEmail: string) {
  return prisma.securityAlert.update({
    where: { id },
    data: { status: "RESOLVED", resolvedAt: new Date(), resolvedBy: adminEmail },
  });
}

export async function pruneSecurityHistory(days = 180) {
  const cutoff = new Date(Date.now() - days * 864e5);
  await Promise.all([
    prisma.loginEvent.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.adminAuditLog.deleteMany({ where: { createdAt: { lt: cutoff } } }),
    prisma.session.deleteMany({ where: { endedAt: { not: null, lt: cutoff } } }),
  ]);
}
