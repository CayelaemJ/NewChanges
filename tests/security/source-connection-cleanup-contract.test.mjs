import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const adapter = readFileSync(new URL("../../src/services/sourceAdapter.ts", import.meta.url), "utf8");
const packageScripts = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).scripts;

test("SQL adapter closes an authenticated primary when replica initialization fails", () => {
  const start = adapter.indexOf("async function createSqlAdapter(");
  const end = adapter.indexOf("async function* iterateReportPages(", start);
  assert.ok(start >= 0 && end > start);
  const setup = adapter.slice(start, end);
  assert.match(setup, /openedPrimary = executor/);
  assert.match(setup, /await closeSourceConnections\(openedPrimary, replicaExecutor, true\)/);
  assert.ok(setup.indexOf("openedPrimary = executor") < setup.indexOf("await closeSourceConnections(openedPrimary, replicaExecutor, true)"));
});

test("SQL adapter closes both connections even when one close rejects", () => {
  const start = adapter.indexOf("async function createSqlAdapter(");
  assert.ok(start >= 0);
  const implementation = adapter.slice(start);
  assert.match(implementation, /async close\(\) \{ await closeSourceConnections\(executor, replicaExecutor\); \}/);
  assert.match(adapter, /import \{ closeSourceConnections \} from "\.\/sourceConnectionCleanup\.js"/);
});

test("source cleanup behavioral and integration tests run in the Docker source gate", () => {
  assert.match(packageScripts["check:source-sync-safety"], /tests\/security\/source-connection-cleanup\.test\.ts/);
  assert.match(packageScripts["check:source-sync-safety"], /tests\/security\/source-connection-cleanup-contract\.test\.mjs/);
});
