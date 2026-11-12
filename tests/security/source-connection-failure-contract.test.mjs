import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../../" + path, import.meta.url), "utf8");
const adapter = read("src/services/sourceAdapter.ts");
const sync = read("src/services/syncService.ts");
const server = read("src/server.ts");
const scripts = JSON.parse(read("package.json")).scripts;

test("SQL connection factory does not attach raw driver diagnostics or connection endpoints", () => {
  assert.match(adapter, /import \{ safeSourceConnectionFailure \} from "\.\/sourceConnectionFailure\.js"/);
  const start = adapter.indexOf("async function createSqlAdapter(");
  const end = adapter.indexOf("async function* iterateReportPages(", start);
  assert.ok(start >= 0 && end > start);
  const setup = adapter.slice(start, end);
  assert.match(setup, /const reason = safeSourceConnectionFailure\(error\)/);
  assert.match(setup, /Could not open .* source connection/);
  assert.doesNotMatch(setup, /const note = error\?\.message/);
  assert.doesNotMatch(setup, /cause: error/);
});

test("source preview and connection test return only classified errors", () => {
  assert.match(sync, /import \{ safeSourceConnectionFailure \} from "\.\/sourceConnectionFailure\.js"/);
  const preview = sync.slice(sync.indexOf("export async function previewSourceSwitch("),
    sync.indexOf("export async function testConnection("));
  const testConnection = sync.slice(sync.indexOf("export async function testConnection("),
    sync.indexOf("export async function recentSyncLogs("));
  for (const fn of [preview, testConnection]) {
    assert.match(fn, /error: safeSourceConnectionFailure\(error\)/);
    assert.doesNotMatch(fn, /error: error\?\.message/);
  }
});

test("replica health HTTP response uses the same safe classifier", () => {
  assert.match(server, /import \{ safeSourceConnectionFailure \} from "\.\/services\/sourceConnectionFailure\.js"/);
  const route = server.slice(server.indexOf('app.get("/api/admin/integration/replica-health"'),
    server.indexOf('app.get("/api/admin/integration/logs"'));
  assert.match(route, /error: safeSourceConnectionFailure\(e\)/);
  assert.doesNotMatch(route, /error: e\?\.message/);
});

test("source failure behavior and integration contracts run in Docker source gate", () => {
  assert.match(scripts["check:source-sync-safety"], /tests\/security\/source-connection-failure\.test\.ts/);
  assert.match(scripts["check:source-sync-safety"], /tests\/security\/source-connection-failure-contract\.test\.mjs/);
});
