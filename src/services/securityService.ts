import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
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
  deviceKey?: string;
}

const trim = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) || undefined : undefined;

export function requestSecurityContext(input: any): RequestSecurityContext {
  const headers = input?.headers ?? {};
  const userAgent = trim(headers["user-agent"], 600);
  const deviceType = trim(headers["x-device-type"], 32);
  const browser = trim(headers["x-browser"], 64);
  const operatingSystem = trim(headers["x-operating-system"], 64);
  const first = (v: unknown) => typeof v === "string" ? v.split(",")[0]?.trim() : undefined;
  // Railway supplies the originating client address at the proxy boundary.
  // Prefer that trusted edge header before Fastify's resolved socket value so
  // telemetry does not fall back to the Railway proxy address.
  const ipAddress = trim(
    first(headers["x-real-ip"]) ??
    input?.ip ??
    first(headers["x-forwarded-for"]) ??
    input?.raw?.socket?.remoteAddress,
    64,
  );
  // Location is deliberately only accepted from an upstream provider. Railway
  // edge region is infrastructure location, not the user's location, so it is
  // never presented as user geography here.
  const country = trim(headers["cf-ipcountry"] ?? headers["x-vercel-ip-country"] ?? headers["x-country-code"] ?? headers["x-geo-country"], 80);
  const region = trim(headers["x-vercel-ip-country-region"] ?? headers["x-geo-region"], 120);
  const city = trim(headers["x-vercel-ip-city"] ?? headers["x-geo-city"], 120);
  const ua = parseUserAgent(userAgent);
  const resolvedDeviceType = deviceType ?? ua.deviceType;
  const resolvedBrowser = browser ?? ua.browser;
  const resolvedOperatingSystem = operatingSystem ?? ua.operatingSystem;
  const deviceKey = ipSafeDeviceKey(resolvedDeviceType, resolvedBrowser, resolvedOperatingSystem, userAgent);
  const geo: { country?: string; region?: string; city?: string } = {};
  return {
    ipAddress,
    userAgent,
    deviceType: resolvedDeviceType,
    browser: resolvedBrowser,
    operatingSystem: resolvedOperatingSystem,
    country: country ?? geo.country,
    region: region ?? geo.region,
    city: city ?? geo.city,
    deviceKey,
  };
}

export async function enrichSecurityContext(input: any): Promise<RequestSecurityContext> {
  const context = requestSecurityContext(input);
  if (context.country || context.region || context.city) return context;
  const geo = await resolveIpGeography(context.ipAddress);
  return { ...context, country: geo.country, region: geo.region, city: geo.city };
}

function ipSafeDeviceKey(deviceType?: string, browser?: string, operatingSystem?: string, userAgent?: string) {
  return createHash("sha256")
    .update([deviceType, browser, operatingSystem, userAgent].map(v => v ?? "").join("|"))
    .digest("hex")
    .slice(0, 32);
}

function isPublicIp(ip?: string) {
  if (!ip) return false;
  const value = ip.replace(/^::ffff:/i, "");
  if (value === "::1" || value === "127.0.0.1" || value === "0.0.0.0") return false;
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(value)) return false;
  return true;
}

async function resolveIpGeography(ip?: string): Promise<{ country?: string; region?: string; city?: string }> {
  if (!isPublicIp(ip)) return {};
  // External IP geolocation is a cross-border processing activity. It is disabled
  // by default until the organisation has documented and approved the POPIA s72
  // transfer basis and vendor/operator controls. Upstream same-request geography
  // headers can still be used when the hosting/proxy contract authorises them.
  const ipHash = createHash("sha256").update(ip!).digest("hex");
  const cached = await prisma.ipGeolocationCache.findUnique({ where: { ipHash } }).catch(() => null);
  if (cached && cached.expiresAt.getTime() > Date.now()) {
    return { country: cached.country ?? undefined, region: cached.region ?? undefined, city: cached.city ?? undefined };
  }
  try {
    const externalGeoEnabled = ["1", "true", "yes"].includes(String(process.env.ENABLE_EXTERNAL_IP_GEOLOCATION || "").toLowerCase());
    if (!externalGeoEnabled) return {};
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const response = await fetch("https://ipwho.is/" + encodeURIComponent(ip!), { signal: controller.signal, headers: { accept: "application/json" } });
    clearTimeout(timeout);
    if (!response.ok) return {};
    const payload: any = await response.json();
    if (payload?.success === false) return {};
    const result = {
      country: typeof payload?.country === "string" ? payload.country.slice(0, 80) : undefined,
      region: typeof payload?.region === "string" ? payload.region.slice(0, 120) : undefined,
      city: typeof payload?.city === "string" ? payload.city.slice(0, 120) : undefined,
    };
    await prisma.ipGeolocationCache.upsert({
      where: { ipHash },
      create: { ipHash, ...result, latitude: Number.isFinite(payload?.latitude) ? payload.latitude : undefined, longitude: Number.isFinite(payload?.longitude) ? payload.longitude : undefined, provider: "ipwho.is", expiresAt: new Date(Date.now() + 7 * 864e5) },
      update: { ...result, latitude: Number.isFinite(payload?.latitude) ? payload.latitude : undefined, longitude: Number.isFinite(payload?.longitude) ? payload.longitude : undefined, provider: "ipwho.is", fetchedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 864e5) },
    }).catch(() => {});
    return result;
  } catch {
    return {};
  }
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
    const email = input.email.toLowerCase().slice(0, 254);
    const previous = input.userId ? await prisma.loginEvent.findFirst({
      where: { userId: input.userId, success: true },
      orderBy: { createdAt: "desc" },
    }) : null;
    await prisma.loginEvent.create({
      data: {
        userId: input.userId ?? undefined,
        email,
        success: input.success,
        failureReason: input.failureReason?.slice(0, 200),
        ...input.context,
      },
    });
    if (!input.success) {
      const burst = await prisma.loginEvent.count({
        where: {
          email,
          success: false,
          createdAt: { gte: new Date(Date.now() - 15 * 60_000) },
          ...(input.context.ipAddress ? { ipAddress: input.context.ipAddress } : {}),
        },
      });
      if (burst >= 5) {
        await prisma.securityAlert.create({
          data: {
            userId: input.userId ?? undefined,
            actorEmail: email,
            type: "LOGIN_BURST",
            severity: burst >= 10 ? "CRITICAL" : "HIGH",
            title: "Repeated failed sign-ins detected",
            summary: email + " has " + burst + " failed sign-in attempts in the last 15 minutes.",
            detail: { ipAddress: input.context.ipAddress, deviceType: input.context.deviceType, burstCount: burst },
            impactCount: burst,
          },
        });
      }
    } else if (input.userId && previous) {
      const deviceChanged = Boolean(input.context.deviceKey && previous.deviceKey && input.context.deviceKey !== previous.deviceKey);
      const locationChanged = Boolean(
        input.context.country && previous.country &&
        [input.context.country, input.context.region, input.context.city].filter(Boolean).join("|") !==
        [previous.country, previous.region, previous.city].filter(Boolean).join("|")
      );
      if (deviceChanged) {
        await prisma.securityAlert.create({
          data: {
            userId: input.userId,
            actorEmail: email,
            type: "NEW_DEVICE",
            severity: "WARNING",
            title: "New device sign-in",
            summary: email + " signed in from a device not previously seen for this account.",
            detail: { deviceType: input.context.deviceType, browser: input.context.browser, operatingSystem: input.context.operatingSystem },
          },
        });
      }
      if (locationChanged) {
        await prisma.securityAlert.create({
          data: {
            userId: input.userId,
            actorEmail: email,
            type: "NEW_LOCATION",
            severity: "WARNING",
            title: "New sign-in location",
            summary: email + " signed in from a new IP-derived location.",
            detail: { country: input.context.country, region: input.context.region, city: input.context.city, ipAddress: input.context.ipAddress },
          },
        });
      }
    }
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
    deviceKey: s.deviceKey,
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


export async function databaseSecuritySnapshot() {
  try {
    const [db, activity, size] = await Promise.all([
      prisma.$queryRaw<Array<{ database: string; username: string; version: string }>>(Prisma.sql`SELECT current_database() AS database, current_user AS username, version() AS version`),
      prisma.$queryRaw<Array<{ total: bigint; active: bigint }>>(Prisma.sql`SELECT count(*) AS total, count(*) FILTER (WHERE state = 'active') AS active FROM pg_stat_activity`),
      prisma.$queryRaw<Array<{ bytes: bigint }>>(Prisma.sql`SELECT pg_database_size(current_database()) AS bytes`),
    ]);
    return {
      status: "healthy",
      database: db[0]?.database ?? "unknown",
      username: db[0]?.username ?? "unknown",
      version: db[0]?.version ?? "unknown",
      connections: Number(activity[0]?.total ?? 0),
      activeConnections: Number(activity[0]?.active ?? 0),
      sizeBytes: Number(size[0]?.bytes ?? 0),
      controls: {
        rawSqlFromAdminUi: false,
        destructiveDbActions: false,
        accessAudit: true,
        sessionRevocation: true,
        securityAlerts: true,
      },
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return { status: "attention", error: "Database security telemetry unavailable.", checkedAt: new Date().toISOString() };
  }
}

export async function listSecurityDevices(limit = 200) {
  const rows = await prisma.session.findMany({
    where: { deviceKey: { not: null } },
    include: { user: { select: { id: true, name: true, email: true, role: true, active: true } } },
    orderBy: { lastSeenAt: "desc" },
    take: Math.min(500, Math.max(1, limit)),
  });
  const groups = new Map<string, any>();
  for (const row of rows) {
    const key = row.userId + ":" + row.deviceKey;
    const current = groups.get(key);
    const item = {
      deviceKey: row.deviceKey,
      user: row.user,
      deviceType: row.deviceType ?? "Unknown",
      browser: row.browser ?? "Unknown",
      operatingSystem: row.operatingSystem ?? "Unknown",
      country: row.country,
      region: row.region,
      city: row.city,
      ipAddress: row.ipAddress,
      lastSeenAt: row.lastSeenAt,
      firstSeenAt: row.createdAt,
      activeSessions: row.endedAt ? 0 : 1,
    };
    if (!current) groups.set(key, item);
    else {
      current.activeSessions += item.activeSessions;
      if (new Date(item.lastSeenAt) > new Date(current.lastSeenAt)) Object.assign(current, { lastSeenAt: item.lastSeenAt, ipAddress: item.ipAddress, country: item.country, region: item.region, city: item.city });
      if (new Date(item.firstSeenAt) < new Date(current.firstSeenAt)) current.firstSeenAt = item.firstSeenAt;
    }
  }
  return [...groups.values()].sort((a,b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
}

export async function listDataAccessEvents(opts: { limit?: number; userId?: string; route?: string } = {}) {
  return prisma.dataAccessEvent.findMany({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.route ? { route: { contains: opts.route } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, opts.limit ?? 200)),
  });
}

export async function recordDataAccessEvent(input: {
  userId?: string | null;
  actorEmail?: string | null;
  method: string;
  route: string;
  resource?: string;
  employerId?: string;
  context?: RequestSecurityContext;
  statusCode?: number;
  durationMs?: number;
}) {
  try {
    await prisma.dataAccessEvent.create({
      data: {
        userId: input.userId ?? undefined,
        actorEmail: input.actorEmail ?? undefined,
        method: input.method,
        route: input.route.slice(0, 180),
        resource: input.resource?.slice(0, 120),
        employerId: input.employerId,
        ipAddress: input.context?.ipAddress,
        deviceKey: input.context?.deviceKey,
        deviceType: input.context?.deviceType,
        statusCode: input.statusCode,
        durationMs: input.durationMs,
      },
    });
  } catch {}
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
    prisma.session.deleteMany({ where: { endedAt: { not: null, lt: cutoff } } }),
  ]);
}
