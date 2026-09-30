// ════════════════════════════════════════════════════════════════════
//  ADMIN AUDIT LOG
//  Every admin-initiated change is recorded here: who, what action, on
//  which record, and a one-line human summary (plus optional structured
//  detail). Logging failures never block the action itself.
// ════════════════════════════════════════════════════════════════════

import { prisma } from "./authService.js";
import { classifyAdminRisk, type RequestSecurityContext } from "./securityService.js";

export async function logAdminAction(
  actor: { email: string; name: string },
  action: string,
  summary: string,
  opts: { targetType?: string; targetId?: string; detail?: unknown; context?: RequestSecurityContext; impactCount?: number } = {},
) {
  try {
    const riskLevel = classifyAdminRisk(action, opts.impactCount);
    const recentCutoff = new Date(Date.now() - 10 * 60 * 1000);
    const recentCount = await prisma.adminAuditLog.count({ where: { actorEmail: actor.email, createdAt: { gte: recentCutoff } } });
    const flagged = riskLevel !== "NORMAL" || recentCount >= 20;
    const effectiveRisk = recentCount >= 20 && riskLevel === "NORMAL" ? "HIGH" : riskLevel;
    const row = await prisma.adminAuditLog.create({
      data: {
        actorEmail: actor.email,
        actorName: actor.name,
        action,
        summary,
        targetType: opts.targetType,
        targetId: opts.targetId,
        detail: opts.detail == null ? undefined : (JSON.parse(JSON.stringify(opts.detail))),
        ipAddress: opts.context?.ipAddress,
        userAgent: opts.context?.userAgent,
        deviceType: opts.context?.deviceType,
        country: opts.context?.country,
        region: opts.context?.region,
        city: opts.context?.city,
        riskLevel: effectiveRisk,
        impactCount: opts.impactCount,
        flagged,
      },
    });
    if (flagged) {
      await prisma.securityAlert.create({
        data: {
          actorEmail: actor.email,
          type: recentCount >= 20 ? "ADMIN_ACTIVITY_SPIKE" : "HIGH_IMPACT_ADMIN_ACTION",
          severity: effectiveRisk === "CRITICAL" ? "CRITICAL" : effectiveRisk === "HIGH" ? "HIGH" : "WARNING",
          title: recentCount >= 20 ? "Unusually high admin activity" : "High-impact admin action detected",
          summary: recentCount >= 20
            ? actor.email + " performed " + (recentCount + 1) + " recorded admin changes in 10 minutes."
            : summary,
          detail: { auditId: row.id, action, targetType: opts.targetType, targetId: opts.targetId, impactCount: opts.impactCount, recentCount: recentCount + 1 },
          impactCount: opts.impactCount ?? (recentCount + 1),
        },
      });
    }
  } catch { /* never let logging break the action it's logging */ }
}

export async function listAuditLog(opts: { limit?: number; actorEmail?: string; targetType?: string } = {}) {
  const limit = Math.min(500, Math.max(1, opts.limit || 100));
  return prisma.adminAuditLog.findMany({
    where: {
      ...(opts.actorEmail ? { actorEmail: opts.actorEmail } : {}),
      ...(opts.targetType ? { targetType: opts.targetType } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}
