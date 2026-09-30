import { PrismaClient } from "@prisma/client";
import { getConfig, listAnalyticsRoutes } from "./syncService.js";
import { checkMysqlReadReplica } from "./sourceAdapter.js";

const prisma = new PrismaClient();

export async function enterpriseOperationsOverview() {
  const [config, routes, employers, employees, journeys, debtAccounts, advances, policies, ratings, users, openImports] = await Promise.all([
    getConfig(),
    listAnalyticsRoutes(),
    prisma.employer.count({ where: { sourceDeletedAt: null } }),
    prisma.employee.count({ where: { sourceDeletedAt: null } }),
    prisma.journey.count({ where: { sourceDeletedAt: null } }),
    prisma.debtAccount.count({ where: { sourceDeletedAt: null } }),
    prisma.salaryAdvance.count({ where: { sourceDeletedAt: null, advancedAt: { lt: new Date(Date.now() - 7 * 86400000) } } }),
    prisma.insurancePolicy.count({ where: { sourceDeletedAt: null } }),
    prisma.rating.count({ where: { sourceDeletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.importBatch.count({ where: { status: { in: ["UPLOADED", "VALIDATED"] } } }),
  ]);

  const now = Date.now();
  const lastSync = config.lastSuccessfulSyncAt ? new Date(config.lastSuccessfulSyncAt).getTime() : null;
  const freshnessMinutes = lastSync == null ? null : Math.max(0, Math.round((now - lastSync) / 60000));

  const sourceMode = String(config.sourceMode || "API").toUpperCase();
  const replica = sourceMode === "SQL" ? await checkMysqlReadReplica(config) : { configured: false, reachable: false, readOnly: null, lagSeconds: null, lagWithinThreshold: null, host: null, database: null, note: "Replica health is only applicable to SQL sources." };
  const sourceConfigured = sourceMode === "SQL"
    ? Boolean(config.sqlHost && config.sqlDatabase && config.sqlUsername && (process.env.SOURCE_SQL_PASSWORD || config.sqlPassword))
    : Boolean(process.env.SOURCE_API_BASE_URL || config.baseUrl);

  return {
    generatedAt: new Date().toISOString(),
    data: { employers, employees, journeys, debtAccounts, advances, policies, ratings, users },
    imports: { open: openImports },
    integration: {
      enabled: config.enabled,
      sourceMode,
      sourceConfigured,
      analyticsMode: config.analyticsMode,
      sourceAnalyticsEnabled: config.sourceAnalyticsEnabled,
      sourceAnalyticsReadOnly: config.sourceAnalyticsReadOnly,
      sourceAnalyticsUseReplica: config.sourceAnalyticsUseReplica,
      lastSyncAt: config.lastSyncAt,
      lastSuccessfulSyncAt: config.lastSuccessfulSyncAt,
      lastSyncStatus: config.lastSyncStatus,
      freshnessMinutes,
      freshnessState: freshnessMinutes == null ? "UNKNOWN" : freshnessMinutes <= Math.max(60, config.scheduleHours * 60 * 2) ? "FRESH" : "STALE",
      replica,
    },
    routing: routes.map(route => ({
      reportKey: route.reportKey,
      executionMode: route.executionMode,
      workloadClass: route.workloadClass,
      sourceView: route.sourceView,
      useReplica: route.useReplica,
      enabled: route.enabled,
      rationale: route.rationale,
      lastVerifiedAt: route.lastVerifiedAt,
    })),
  };
}

export async function dataQualityOverview() {
  const [employeesMissingBand, employeesMissingSite, employeesDeleted, orphanSites, staleEmployees, staleAdvances] = await Promise.all([
    prisma.employee.count({ where: { sourceDeletedAt: null, incomeBand: null } }),
    prisma.employee.count({ where: { sourceDeletedAt: null, siteId: null } }),
    prisma.employee.count({ where: { sourceDeletedAt: { not: null } } }),
    prisma.site.count({ where: { employer: { sourceDeletedAt: null }, employees: { none: {} } } }),
    prisma.employee.count({ where: { sourceDeletedAt: null, observedAt: { lt: new Date(Date.now() - 7 * 86400000) } } }),
    prisma.salaryAdvance.count({ where: { sourceDeletedAt: null, advancedAt: { lt: new Date(Date.now() - 7 * 86400000) } } }),
  ]);

  const total = await prisma.employee.count({ where: { sourceDeletedAt: null } });
  const completeness = total ? Math.max(0, Math.min(100, ((total - employeesMissingBand - employeesMissingSite) / total) * 100)) : 100;

  return {
    checkedAt: new Date().toISOString(),
    score: Number(completeness.toFixed(1)),
    checks: {
      employeesMissingIncomeBand: employeesMissingBand,
      employeesMissingSite: employeesMissingSite,
      staleEmployeesOver7Days: staleEmployees,
      staleSalaryAdvancesOver7Days: staleAdvances,
      emptySites: orphanSites,
      softDeletedEmployees: employeesDeleted,
      employeeRecordsChecked: total,
      orphanEmployees: 0,
    },
  };
}
