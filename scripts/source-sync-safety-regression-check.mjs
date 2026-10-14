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
const governance = read("../src/services/sourceGovernance.ts");
const schema = read("../prisma/schema.prisma");
for (const model of ["SourceGeneration", "SourceGenerationCursor", "SemanticSnapshotManifest"]) {
  assert(schema.includes(`model ${model} {`), `${model} metadata model required`);
}
assert(governance.includes("previewSourceSwitch(patch)"), "candidate registry must preflight before storing metadata");
assert(governance.includes('activationAvailable: false'), "unsafe source activation must remain blocked");
assert(!governance.includes("saveConfig(") && !governance.includes("deleteMany("), "candidate registration must not change live source or purge data");
assert(governance.includes("generationId_reportKey"), "source cursors must be partitioned by generation");
assert(governance.includes("MANIFEST_ONLY"), "semantic store must disclose incomplete external publication support");
assert(server.includes('"/api/admin/integration/stage-source"'), "Admin candidate staging endpoint required");
const gates = read("../src/services/semanticPublicationGates.ts");
for (const model of ["SemanticPublicationPointer", "SemanticPublicationAudit"]) {
  assert(schema.includes(`model ${model} {`), `Missing ${model} publication control model`);
}
assert(gates.includes("storageVerified: false, sha256Verified: false"), "semantic publication must fail closed without object storage verification");
assert(gates.includes("evaluatePublicationGates"), "semantic publication gates required");
assert(server.includes('"/api/admin/mlops/semantic-publications/:manifestId/readiness"'), "Admin readiness endpoint required");
const queue = read("../src/services/semanticRefreshQueue.ts");
const storage = read("../src/services/semanticObjectVerification.ts");
assert(schema.includes("model SemanticRefreshJob {"), "Durable semantic queue schema required");
assert(queue.includes("skipDuplicates:true"), "Coalesced queue must deduplicate writes");
assert(queue.includes("FOR UPDATE SKIP LOCKED"), "Workers must avoid competing claims");
assert(queue.includes('"leasedUntil"'), "Worker lease required");
assert(storage.includes('redirect:"error"'), "External object requests must not follow redirects");
assert(storage.includes('actual!==expected'), "Object must pass independent SHA-256 verification");
assert(storage.includes('persisted.byteLength!==input.content.byteLength'), "Object length must be verified");
const publisher = read("../src/services/semanticPublisher.ts");
assert(publisher.includes('isolationLevel:"Serializable"'), "Publications and rollback must be serializable");
assert(publisher.includes('semanticPublicationAudit.create'), "Every publication needs an audit record");
assert(publisher.includes("expectedPreviousManifestId"), "Publisher must prevent overwriting concurrently published versions");
assert(publisher.includes("expectedCurrentManifestId"), "Rollback must require the expected live version");
assert(!server.includes('"/api/admin/mlops/semantic-publications/publish"'), "Unsafe external publication endpoint forbidden");
const pipeline=read("../src/services/semanticObjectPipeline.ts");
assert(pipeline.includes('ENABLE_SEMANTIC_OBJECT_PUBLISH'), "semantic serving must be opt-in");
assert(pipeline.includes('putAndVerifySemanticObject'), "semantic publish requires verified external storage");
assert(pipeline.includes('publishVerifiedSemanticManifest'), "semantic publish requires atomic pointer transaction");
assert(pipeline.includes('evaluatePublicationGates'), "semantic publish requires data quality gates");
assert(governance.includes('update: { validation, validatedAt: now }'), "source revalidation must not demote an active source");
const queueHealth = read("../src/services/semanticQueueHealth.ts");
assert(queueHealth.includes("semanticRefreshJob.groupBy"), "MLOps queue health must aggregate without raw dashboard scans");
assert(server.includes('"/api/admin/mlops/semantic-queue-health"'), "Admin queue health endpoint required");
const shadow=read("../src/services/semanticShadowWorker.ts");
assert(shadow.includes('ENABLE_SEMANTIC_SHADOW_WORKER'), "shadow worker must be opt in");
assert(shadow.includes('getPublishedDashboardPayload'), "shadow worker must use last published payload, never raw source scans");
assert(shadow.includes('finishSemanticRefresh'), "worker must complete durable queue jobs");
assert(!server.includes("processOneShadowSemanticRefresh("), "web server must not accidentally start shadow worker");
assert(sync.includes('ENABLE_SEMANTIC_SHADOW_ENQUEUE'), "shadow enqueue must be explicitly opt-in");
assert(sync.includes('generation?.state !== "ACTIVE"'), "shadow enqueue must validate the assigned source generation");
assert(sync.includes('trigger !== "full-refresh"'), "full source reset must not produce shadow incremental work");
assert(sync.includes('summary.semanticShadowQueue'), "shadow queue failures must remain independently observable");
console.log("Source synchronization safety regression checks passed.");
