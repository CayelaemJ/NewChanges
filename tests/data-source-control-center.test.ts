import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildDataSourceControlOverview } from "../src/services/dataSourceControlCenter.js";

const active = {
  configured: true,
  enabled: true,
  effectiveSourceMode: "SQL",
  effectiveSqlDialect: "MYSQL",
  lastSuccessfulSyncAt: "2026-11-15T12:00:00Z",
  lastSyncStatus: "SUCCESS",
};
const generations = [
  { id: "c123", state: "VALIDATED", sourceMode: "SQL", validatedAt: "2026-11-15T15:00:00Z",
    endpointLabel: "SECRET_MYSQL_ENDPOINT", vault: "SECRET_REFERENCE", password: "RAW_SECRET" },
  { id: "c456", state: "CANDIDATE", sourceMode: "API" },
  { id: "c789", state: "ACTIVE", sourceMode: "SQL" },
];
const watcher = { status: "STALE", lastCheckedAt: "2026-11-15T12:05:00Z",
  lastChangedFeeds: 2, lastErrorClass: "SENSITIVE_DB_ERROR" };

test("show current SQL importer without claiming a live CDC pipeline", () => {
  const o = buildDataSourceControlOverview(active, generations, watcher);
  assert.equal(o.activeSource.status, "ENABLED_LEGACY_IMPORT");
  assert.equal(o.activeSource.driver, "MYSQL");
  assert.equal(o.activeSource.strategy, "LEGACY_IMPORT_TO_APP_READ_MODEL");
  assert.equal(o.summary.enabledIntegrations, 1);
  assert.equal(o.summary.cdcProductionReady, false);
  assert.equal(o.cdcPilot.state, "BLOCKED_NOT_DEPLOYED");
  assert.equal(o.cdcPilot.currentDashboardWiring, "NOT_CONNECTED");
  assert.equal(o.architecture, "ONE_ACTIVE_INTEGRATION_AND_STAGED_GENERATIONS");
  assert.equal(o.onboarding.simultaneousActiveSources, false);
});

test("candidate stage, validated and active-generation states are distinct", () => {
  const o = buildDataSourceControlOverview(active, generations, watcher);
  assert.deepEqual(o.candidates.map(c => c.status), [
    "VALIDATED","STAGED","ACTIVE_GENERATION",
  ]);
  assert.equal(o.summary.staged, 2);
  assert.equal(o.summary.trackedEntries, 4);
  assert.equal(o.candidates[0].validatedAt, "2026-11-15T15:00:00.000Z");
});

test("metadata response never serializes source hosts, credentials, errors or vault paths", () => {
  const contaminated = {
    ...active, sqlPassword: "MYSQL_SECRET", sqlHost: "PRIVATE_RDS_HOST",
    authToken: "API_BEARER_SECRET", sourceAnalyticsReplicaPassword: "REPLICA_SECRET",
  };
  const o = buildDataSourceControlOverview(contaminated, generations, watcher);
  const json = JSON.stringify(o);
  for (const forbidden of [
    "MYSQL_SECRET","PRIVATE_RDS_HOST","API_BEARER_SECRET","REPLICA_SECRET",
    "SECRET_MYSQL_ENDPOINT","SECRET_REFERENCE","RAW_SECRET","SENSITIVE_DB_ERROR",
  ]) assert(!json.includes(forbidden), forbidden);
});

test("a configured but disabled source is paused, not reported as connected", () => {
  const o = buildDataSourceControlOverview({ ...active, enabled: false }, [], {});
  assert.equal(o.activeSource.status, "PAUSED");
  assert.equal(o.summary.enabledIntegrations, 0);
  assert.equal(o.polling.status, "UNKNOWN");
});

test("missing configuration is not a running or connected source", () => {
  const o = buildDataSourceControlOverview({ configured: false, enabled: true }, [], {});
  assert.equal(o.activeSource.status, "NOT_CONFIGURED");
  assert.equal(o.summary.enabledIntegrations, 0);
  assert.equal(o.summary.trackedEntries, 0);
});

test("unknown source platforms and malformed candidates fail to safe labels", () => {
  const o = buildDataSourceControlOverview({
    ...active, effectiveSourceMode: "MYSQL;DROP", effectiveSqlDialect: "ROOT",
    lastSyncStatus: "PASSWORD=HIDDEN",
  }, [
    { id: "../../secret", sourceMode: "SQL", state: "VALIDATED" },
    { id: "safe", sourceMode: "MALICIOUS", state: "SOMETHING" },
  ], { status: "UNSAFE", lastChangedFeeds: -5 });
  assert.equal(o.activeSource.sourceType, "UNKNOWN");
  assert.equal(o.activeSource.driver, "UNKNOWN");
  assert.equal(o.activeSource.lastSyncStatus, "OTHER");
  assert.equal(o.candidates.length, 1);
  assert.equal(o.candidates[0].sourceType, "UNKNOWN");
  assert.equal(o.candidates[0].status, "UNKNOWN");
  assert.equal(o.polling.status, "UNKNOWN");
  assert.equal(o.polling.changedFeedsLastPoll, null);
});

test("supported connectors do not promise generic mapping or active multi-source", () => {
  const o = buildDataSourceControlOverview(active, [], watcher);
  assert.deepEqual(o.availableConnectors.map(c => c.driver), [
    "MYSQL","POSTGRESQL","MSSQL","API",
  ]);
  assert.equal(o.onboarding.schemaMappingCapability, "PLANNED_NOT_IMPLEMENTED");
  assert.equal(o.onboarding.currentCapability,
    "TEST_AND_STAGE_ONE_CANDIDATE_WITHOUT_SWITCHING_ACTIVE_SOURCE");
  assert.equal(o.onboarding.link, "/admin#live-integration");
});

test("read-only admin route enforces requireAdmin before accessing config", () => {
  const server = readFileSync(new URL("../src/server.ts", import.meta.url), "utf8");
  const start = server.indexOf('app.get("/api/admin/data-sources/overview"');
  assert(start > 0);
  const handler = server.slice(start, start + 680);
  const auth = handler.indexOf("requireAdmin(req, reply)");
  const config = handler.indexOf("getSyncConfig()");
  assert(auth >= 0);
  assert(config > auth);
  assert(handler.includes("buildDataSourceControlOverview"));
  assert(!handler.includes("runSync("));
  assert(!handler.includes("saveSyncConfig("));
});

test("React admin has a distinct data-sources tab without changing dashboard endpoints", () => {
  const app = readFileSync(new URL("../frontend/src/App.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../frontend/src/components/DataSourcesControlCenter.tsx", import.meta.url), "utf8");
  assert(app.includes('["sources","Data sources & CDC"]'));
  assert(app.includes('tab==="sources"&&<DataSourcesControlCenter'));
  assert(panel.includes("/api/admin/data-sources/overview"));
  assert(panel.includes("Stage a database"));
  assert(panel.includes("simultaneously active sources"));
  assert(!panel.includes("/api/admin/integration/sync-now"));
  assert(!panel.includes("method: \"POST\""));
});
