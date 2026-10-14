import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const server = read("../src/server.ts");
const react = read("../frontend/src/App.tsx");
const legacy = read("../public/admin.html");

function route(source, marker, next) {
  const from = source.indexOf(marker);
  assert(from >= 0, `Missing endpoint ${marker}`);
  const to = source.indexOf(next, from + marker.length);
  assert(to > from, `Missing endpoint boundary for ${marker}`);
  return source.slice(from, to);
}
const changes = route(server, 'app.get("/api/admin/integration/changes"', '// Non-destructive manual sync.');
assert(changes.includes("requireAdmin"), "change detection requires Admin");
assert(changes.includes("detectSourceChanges()"), "health check must detect source changes");

const refresh = route(server, 'app.post("/api/admin/integration/refresh"', '// ── DANGER: purge');
assert(refresh.includes('runSync("manual")'), "refresh must be incremental");
assert(!refresh.includes("triggerRefreshNow"), "refresh must not invoke full purge");
assert(!refresh.includes("purge"), "refresh must not purge data");

const reset = route(server, 'app.post<{ Body: { confirm?: string } }>("/api/admin/integration/full-resync"', 'app.get("/api/admin/integration/replica-health"');
assert(reset.includes('req.body?.confirm') && reset.includes('"RESET"'), "full resync must require explicit confirmation");
assert(reset.includes('triggerRefreshNow("reset")'), "recovery resync should retain the explicit full path");
assert(react.includes('api("/api/admin/integration/changes")'), "health UI must perform read-only change check");
assert(!react.includes('api("/api/admin/integration/refresh",{method:"POST"})'), "health UI must not trigger refresh");
const legacyRefresh = legacy.slice(legacy.indexOf("async function refreshNow(btn){"), legacy.indexOf("function syncLogFailureDetail"));
assert(!legacyRefresh.includes("saveBody=integrationDraft()"), "sync must not silently switch the configured database");
assert(legacyRefresh.includes("incremental sync"), "legacy refresh must explain safe incremental behavior");
const sync = read("../src/services/syncService.ts");
assert(server.includes('"/api/admin/integration/preview-switch"'), "candidate preflight endpoint must exist");
assert(sync.includes("export async function previewSourceSwitch"), "staged preview must be supported");
const preview = sync.slice(sync.indexOf("export async function previewSourceSwitch"), sync.indexOf("export async function testConnection"));
assert(preview.includes("adapter.test()"), "preflight must validate canonical view schemas");
assert(preview.includes("adapter.watermark(reportKey)"), "preflight should check source freshness without importing");
assert(!preview.includes("saveConfig(") && !preview.includes("runSync(") && !preview.includes("deleteMany("), "preflight cannot mutate source or dashboard data");
assert(preview.includes("canReuseCurrentCursors: !sourceChanged"), "new source must not silently reuse old checkpoints");
console.log("Source synchronization safety regression checks passed.");
