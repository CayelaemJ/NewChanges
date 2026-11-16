/**
 * The Fixer | Admin-only multi-source control-plane read model.
 *
 * This deliberately accepts SAFE projections and never opens a data source,
 * returns secrets/hosts/connection strings, or activates a staged source.
 * The current app has ONE active integration + multiple staged generations.
 * It is not yet a multi-active-source runtime or proof of CDC readiness.
 */
export type SourceControlState =
  "ENABLED_LEGACY_IMPORT" | "PAUSED" | "NOT_CONFIGURED" |
  "STAGED" | "VALIDATED" | "ACTIVE_GENERATION" | "RETIRED" | "UNKNOWN";

export interface SourceControlConfig {
  enabled?: boolean | null;
  configured?: boolean | null;
  effectiveSourceMode?: string | null;
  effectiveSqlDialect?: string | null;
  lastSuccessfulSyncAt?: string | Date | null;
  lastSyncStatus?: string | null;
  sourceChangeSchedulerEnabled?: boolean | null;
}
export interface SourceGenerationPreview {
  id: string;
  sourceMode: string;
  state: string;
  validatedAt?: string | Date | null;
  activatedAt?: string | Date | null;
  updatedAt?: string | Date | null;
}
export interface SourceWatchPreview {
  status?: string | null;
  observerScope?: string | null;
  lastCheckedAt?: string | null;
  lastFailureAt?: string | null;
  pollCount?: number | null;
  lastChangedFeeds?: number | null;
}

const supported = Object.freeze([
  { driver: "MYSQL", label: "MySQL / MariaDB", support: "EXISTING_SQL_IMPORT", futureCdc: "BINLOG_SECURITY_REVIEW" },
  { driver: "POSTGRESQL", label: "PostgreSQL", support: "EXISTING_SQL_IMPORT", futureCdc: "LOGICAL_REPLICATION_REVIEW" },
  { driver: "MSSQL", label: "SQL Server", support: "EXISTING_SQL_IMPORT", futureCdc: "SQL_SERVER_CDC_REVIEW" },
  { driver: "API", label: "HTTPS API", support: "EXISTING_API_IMPORT", futureCdc: "POLL_OR_WEBHOOK_REVIEW" },
] as const);

function iso(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function safeType(value: string | null | undefined): string {
  const normalized = String(value ?? "").toUpperCase();
  return ["SQL","API"].includes(normalized) ? normalized : "UNKNOWN";
}
function safeDriver(value: string | null | undefined): string {
  const normalized = String(value ?? "").toUpperCase();
  return ["MYSQL","POSTGRESQL","MSSQL"].includes(normalized) ? normalized : "UNKNOWN";
}
function safeState(value: string | null | undefined): SourceControlState {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "VALIDATED") return "VALIDATED";
  if (normalized === "ACTIVE") return "ACTIVE_GENERATION";
  if (normalized === "CANDIDATE") return "STAGED";
  if (normalized === "RETIRED") return "RETIRED";
  return "UNKNOWN";
}

/** No network/database IO. Sensitive fields never survive this mapping. */
export function buildDataSourceControlOverview(
  current: SourceControlConfig,
  staged: readonly SourceGenerationPreview[],
  watcher: SourceWatchPreview,
) {
  const configured = current.configured === true;
  const active = configured && current.enabled === true;
  const activeState: SourceControlState = !configured
    ? "NOT_CONFIGURED" : active ? "ENABLED_LEGACY_IMPORT" : "PAUSED";
  const candidates = staged
    .filter(g => g && typeof g.id === "string" &&
      /^[a-zA-Z0-9_-]{1,100}$/.test(g.id) && typeof g.state === "string")
    .slice(0, 30).map(g => ({
      id: g.id,
      label: "Staged source generation",
      sourceType: safeType(g.sourceMode),
      status: safeState(g.state),
      validatedAt: iso(g.validatedAt),
      activatedAt: iso(g.activatedAt),
      updatedAt: iso(g.updatedAt),
      // endpointLabel, connection settings, vault reference, source rows
      // and credentials are deliberately never projected here.
    }));
  const source = {
    id: "active",
    label: "Current integration",
    sourceType: safeType(current.effectiveSourceMode),
    driver: safeDriver(current.effectiveSqlDialect),
    status: activeState,
    strategy: "LEGACY_IMPORT_TO_APP_READ_MODEL",
    lastSuccessfulSyncAt: iso(current.lastSuccessfulSyncAt),
    lastSyncStatus: typeof current.lastSyncStatus === "string"
      ? (["SUCCESS","FAILED","PROCESSING","PARTIAL","REBUILDING"].includes(current.lastSyncStatus.toUpperCase())
        ? current.lastSyncStatus.toUpperCase() : "OTHER")
      : null,
  };
  const observationStatus = ["PAUSED","STALE","DEGRADED","RUNNING"]
    .includes(String(watcher.status ?? "").toUpperCase())
    ? String(watcher.status).toUpperCase() : "UNKNOWN";
  return {
    schemaVersion: 1,
    observedAt: new Date().toISOString(),
    architecture: "ONE_ACTIVE_INTEGRATION_AND_STAGED_GENERATIONS",
    dataResidency: "EXISTING_DASHBOARDS_USE_POSTGRES_READ_MODEL",
    activeSource: source,
    candidates,
    availableConnectors: supported,
    summary: {
      enabledIntegrations: active ? 1 : 0,
      staged: candidates.filter(g => g.status === "STAGED" || g.status === "VALIDATED").length,
      trackedEntries: (configured ? 1 : 0) + candidates.length,
      cdcProductionReady: false,
    },
    polling: {
      status: observationStatus,
      scope: "THIS_PROCESS_LEGACY_SOURCE_WATCHER",
      lastCheckedAt: iso(watcher.lastCheckedAt),
      lastFailureAt: iso(watcher.lastFailureAt),
      // This is not a cross-worker health metric or RDS binlog lag.
      changedFeedsLastPoll: Number.isSafeInteger(watcher.lastChangedFeeds) &&
        (watcher.lastChangedFeeds ?? -1) >= 0 ? watcher.lastChangedFeeds : null,
    },
    cdcPilot: {
      label: "MySQL ROW binlog CDC pilot — PR #237",
      mode: "FEED_LEVEL_INVALIDATION",
      state: "BLOCKED_NOT_DEPLOYED",
      localDockerBaseline: "118/118 PASS (operator-reported)",
      sourceViewIdentity: "0/10_EXPOSE_PHYSICAL_ID",
      currentDashboardWiring: "NOT_CONNECTED",
      prerequisites: [
        "APPROVED_RDS_BINLOG_RETENTION",
        "REPLICATION_SCOPE_PRIVACY_REVIEW",
        "CONSISTENT_INITIAL_SNAPSHOT",
        "VERIFIED_READONLY_ACCOUNT",
        "MULTI_WORKER_PUBLICATION",
        "AGGREGATION_AND_DASHBOARD_PARITY",
      ],
      // No fabricated lag, freshness, throughput or cost figures.
    },
    onboarding: {
      connectedPlatforms: ["MYSQL", "POSTGRESQL", "MSSQL", "API"],
      currentCapability: "TEST_AND_STAGE_ONE_CANDIDATE_WITHOUT_SWITCHING_ACTIVE_SOURCE",
      simultaneousActiveSources: false,
      schemaMappingCapability: "OFFLINE_TEN_FEED_PLANNER_AVAILABLE_NOT_ACTIVATED",
      link: "/admin#live-integration",
    },
  };
}
