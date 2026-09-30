// ════════════════════════════════════════════════════════════════════
//  ADMIN DATA EXPORT — CSV
//  Simple, dependency-free CSV building (no xlsx tooling needed here).
// ════════════════════════════════════════════════════════════════════

import { prisma } from "./authService.js";
import { getFormat } from "./reportFormats.js";

function csvEscape(value: unknown): string {
  if (value == null) return "";
  const s = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const header = columns.join(",");
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(",")).join("\n");
  return header + "\n" + body + (body ? "\n" : "");
}

export async function exportAuditLogCsv() {
  const rows = await prisma.adminAuditLog.findMany({ orderBy: { createdAt: "desc" } });
  return toCsv(rows as any, ["createdAt", "actorName", "actorEmail", "action", "targetType", "targetId", "summary", "detail"]);
}

export async function exportSecurityAuditLogCsv() {
  const [adminRows, accessRows, loginRows, alertRows] = await Promise.all([
    prisma.adminAuditLog.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.dataAccessEvent.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.loginEvent.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.securityAlert.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  const columns = [
    "createdAt", "eventType", "actorEmail", "actorName", "userId",
    "action", "targetType", "targetId", "resource", "method", "route",
    "statusCode", "success", "severity", "alertType", "ipAddress",
    "deviceType", "country", "region", "city", "summary",
  ];

  const rows = [
    ...adminRows.map((r) => ({
      createdAt: r.createdAt, eventType: "ADMIN_ACTION", actorEmail: r.actorEmail, actorName: r.actorName,
      action: r.action, targetType: r.targetType, targetId: r.targetId, summary: r.summary,
      ipAddress: r.ipAddress, deviceType: r.deviceType, country: r.country, region: r.region, city: r.city,
    })),
    ...accessRows.map((r) => ({
      createdAt: r.createdAt, eventType: "DATA_ACCESS", actorEmail: r.actorEmail, userId: r.userId,
      resource: r.resource, method: r.method, route: r.route, statusCode: r.statusCode,
      ipAddress: r.ipAddress, deviceType: r.deviceType,
    })),
    ...loginRows.map((r) => ({
      createdAt: r.createdAt, eventType: "LOGIN", actorEmail: r.email, userId: r.userId,
      success: r.success, action: r.success ? "login_success" : "login_failed",
      ipAddress: r.ipAddress, deviceType: r.deviceType, country: r.country, region: r.region, city: r.city,
      summary: r.failureReason,
    })),
    ...alertRows.map((r) => ({
      createdAt: r.createdAt, eventType: "SECURITY_ALERT", actorEmail: r.actorEmail, userId: r.userId,
      action: r.status === "RESOLVED" ? "alert_resolved" : "alert_open",
      severity: r.severity, alertType: r.type, summary: r.title + (r.summary ? ": " + r.summary : ""),
    })),
  ].sort((a, b) => new Date(b.createdAt as Date).getTime() - new Date(a.createdAt as Date).getTime());

  return toCsv(rows, columns);
}

export async function exportEmployeesCsv(employerId?: string) {
  const rows = await prisma.employee.findMany({
    where: employerId ? { employerId } : {},
    select: { id: true, employerId: true, siteId: true, payrollRef: true, incomeBand: true, active: true, eligibleFrom: true, eligibleTo: true, observedAt: true, sourceUpdatedAt: true },
    take: 50000,
  });
  return toCsv(rows as any, ["id", "employerId", "siteId", "payrollRef", "incomeBand", "active", "eligibleFrom", "eligibleTo", "observedAt", "sourceUpdatedAt"]);
}

export async function exportDebtAccountsCsv(employerId?: string) {
  const rows = await prisma.debtAccount.findMany({
    where: employerId ? { platformUser: { employee: { employerId } } } : {},
    select: {
      id: true, platformUserId: true, creditorName: true, creditType: true, balanceCents: true,
      inArrears: true, state: true, challengeStatus: true, observedAt: true, closedAt: true,
    },
    take: 50000,
  });
  const mapped = rows.map((r: any) => ({ ...r, balanceRand: (r.balanceCents / 100).toFixed(2) }));
  return toCsv(mapped, ["id", "platformUserId", "creditorName", "creditType", "balanceRand", "inArrears", "state", "challengeStatus", "observedAt", "closedAt"]);
}

export async function exportInsurancePoliciesCsv(employerId?: string) {
  const rows = await prisma.insurancePolicy.findMany({
    where: employerId ? { platformUser: { employee: { employerId } } } : {},
    select: { id: true, platformUserId: true, type: true, premiumCents: true, isWasteful: true, isResolved: true, observedAt: true, resolvedAt: true },
    take: 50000,
  });
  const mapped = rows.map((r: any) => ({ ...r, premiumRand: (r.premiumCents / 100).toFixed(2) }));
  return toCsv(mapped, ["id", "platformUserId", "type", "premiumRand", "isWasteful", "isResolved", "observedAt", "resolvedAt"]);
}

export async function exportScoreSnapshotsCsv(employerId?: string) {
  const rows = await prisma.scoreSnapshot.findMany({
    where: employerId ? { employerId } : {},
    orderBy: [{ employerId: "asc" }, { period: "desc" }],
    select: { employerId: true, period: true, optimiseScore: true, payload: true, asAt: true },
    take: 50000,
  });
  const mapped = rows.map((row) => ({
    employerId: row.employerId,
    period: row.period,
    optimiseScore: row.optimiseScore,
    headcount: typeof row.payload === "object" && row.payload !== null && "headcount" in row.payload
      ? (row.payload as { headcount?: unknown }).headcount
      : null,
    asAt: row.asAt,
  }));
  return toCsv(mapped, ["employerId", "period", "optimiseScore", "headcount", "asAt"]);
}

export async function exportUsersCsv() {
  const rows = await prisma.user.findMany({
    select: { id: true, email: true, name: true, role: true, active: true, partnerId: true, createdAt: true, revokedAt: true, revokedReason: true, revokedBy: true },
    orderBy: { createdAt: "desc" },
  });
  return toCsv(rows as any, ["id", "email", "name", "role", "active", "partnerId", "createdAt", "revokedAt", "revokedReason", "revokedBy"]);
}

/** Export the exact source rows uploaded for an import batch as CSV. */
export async function exportImportBatchCsv(batchId: string) {
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: { rows: { orderBy: { rowIndex: "asc" }, select: { data: true } } },
  });
  if (!batch) throw new Error("Import batch not found");
  const format = getFormat(batch.reportKey);
  if (!format) throw new Error(`Unknown report: ${batch.reportKey}`);
  const columns = format.fields.map((field: any) => field.name);
  const rows = batch.rows.length
    ? batch.rows.map((row: any) => row.data as Record<string, unknown>)
    : ((batch.stagedRows ?? []) as Record<string, unknown>[]);
  return toCsv(rows, columns);
}
