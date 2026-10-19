import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const seed=readFileSync("scripts/fixtures/semantic-neon-testing-20261019.sql","utf8");
const runner=readFileSync("scripts/semantic-testing-score-delta.ts","utf8");
const preflight=readFileSync("scripts/semantic-e2e-preflight.mjs","utf8");

assert(seed.includes("current_database() <> 'newchanges_testing_20261017'"),
  "Fixture must enforce exact isolated Neon database identity");
assert(!/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|UPDATE\s+)/i.test(seed),
  "Fixture must remain insert-only; never delete or overwrite data");

const forbiddenSql=/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+TABLE|UPDATE\s+)/i;
for(const destructive of ['DELETE FROM "Employer"','TRUNCATE "Employee"','DROP TABLE "Journey"','UPDATE "Employer" SET'])
  assert(forbiddenSql.test(destructive),"Fixture safety guard must detect destructive SQL: "+destructive);

for(const table of ["Employer","EmployerHeadcountSnapshot","Employee","PlatformUser",
  "Journey","DebtAccount","InsurancePolicy","Rating","Referral","SalaryAdvance",
  "AchievableTarget","SourceGeneration","SourceGenerationCursor"])
  assert(seed.includes('INSERT INTO "'+table+'"'),"Missing synthetic table: "+table);
assert.equal((seed.match(/INSERT INTO "SourceGenerationCursor"/g)||[]).length,10,
  "Fixture requires precisely ten synthetic feed reconciliation cursors");
assert(runner.includes('SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY"'),
  "Score-delta rehearsal must require explicit opt-in");
assert(runner.includes('url.pathname!=="/"+databaseName'),
  "Score-delta rehearsal must fail closed on the database name");
assert(runner.includes("await snapshotEmployer(employerId,period)"),
  "Score-delta rehearsal must run the actual application score builder");
assert(runner.includes("assert.notEqual(after,before"),
  "Score-delta rehearsal must demonstrate a changed score");
assert(runner.includes("if(changed) {") && runner.includes("Synthetic Testing journey and baseline score restored"),
  "Rehearsal must restore its own source fixture and persisted baseline");
assert(!runner.includes("stageAndPublishSemanticObject("),
  "Synthetic-only rehearsal must not publish manifests without durable storage");
assert(preflight.includes("BEGIN READ ONLY"),"Preflight must not write to database");
const queueRunner=readFileSync("scripts/semantic-testing-queue.ts","utf8");
const queueService=readFileSync("src/services/semanticRefreshQueue.ts","utf8");
const circleci=readFileSync(".circleci/config.yml","utf8");
assert(queueRunner.includes("claimSemanticRefresh(workerId,180,{generationId,employerId})"),
  "Testing queue must claim only its synthetic source and employer");
assert(queueRunner.includes("prisma.semanticRefreshJob.deleteMany"),
  "Testing queue must clean only its own synthetic job");
assert(queueRunner.includes('SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY"'),
  "Testing queue requires explicit approval");
assert(queueService.includes('AND (${scopeGeneration} = \'\' OR "generationId" = ${scopeGeneration})'),
  "Source-scoped claim SQL must filter by exact generation");
assert(queueService.includes('AND (${scopeEmployer} = \'\' OR "employerId" = ${scopeEmployer})'),
  "Source-scoped claim SQL must filter by exact employer");
assert(circleci.includes("semantic_testing_e2e:") && circleci.includes("default: false"),
  "Database-backed CI pipeline must default to disabled");
assert(circleci.includes("npm run semantic:e2e:score-delta") &&
  circleci.includes("npm run semantic:e2e:queue"),
  "Manual CircleCI Testing job must execute both isolated database rehearsals");
const publicationRunner=readFileSync("scripts/semantic-testing-publication.ts","utf8");
assert(publicationRunner.includes('SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY"'),
  "Publication rehearsal requires explicit Testing-only approval");
assert(publicationRunner.includes('u.pathname!=="/"+databaseName'),
  "Publication rehearsal must refuse non-Testing database names");
assert(publicationRunner.includes("publishVerifiedSemanticManifest({") &&
  publicationRunner.includes("rollbackSemanticPublication({"),
  "Publication rehearsal must use actual application publisher and rollback");
assert(publicationRunner.includes("stale,expectedPreviousManifestId:updated.manifestId"),
  "Publication rehearsal must reject older source watermark");
assert(publicationRunner.includes("semanticPublicationAudit.findMany"),
  "Rollback rehearsal must inspect persisted audit history");
assert(publicationRunner.includes("ownedIds.includes(existing.manifestId)") &&
  publicationRunner.includes("semanticSnapshotManifest.deleteMany"),
  "Publication cleanup must be limited to records owned by its invocation");
assert(publicationRunner.includes("objectStoreVerified:false"),
  "Metadata-only rehearsal must never claim external durability");
assert(circleci.includes("npm run semantic:e2e:publication-metadata"),
  "Manual CircleCI Testing workflow must include publication and rollback rehearsal");
assert(circleci.includes("context: newchanges-neon-testing"),
  "Manual CircleCI Testing workflow must use restricted Testing credentials");
const transportPublication=readFileSync("scripts/semantic-testing-storage-publication.ts","utf8");
assert(transportPublication.includes('SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY"'),
  "Storage/publication rehearsal must require explicit Testing-only approval");
assert(transportPublication.includes('u.pathname!=="/"+database'),
  "Storage/publication rehearsal must reject any other database");
assert(transportPublication.includes("stageAndPublishSemanticObject({"),
  "Storage/publication rehearsal must execute the real application stage-and-publish service");
assert(transportPublication.includes("rollbackSemanticPublication({"),
  "Storage/publication rehearsal must exercise real audited rollback");
assert(transportPublication.includes("globalThis.fetch=async(input,init)=>") &&
  transportPublication.includes('u.hostname!=="synthetic-s3.example.invalid"'),
  "Synthetic storage must use a fail-closed in-memory transport without network egress");
assert(transportPublication.includes("externalDurabilityVerified:false"),
  "In-memory transport must never claim durable S3 verification");
assert(transportPublication.includes("if(pointer && !ids.includes(pointer.manifestId))") &&
  transportPublication.includes("semanticSnapshotManifest.deleteMany"),
  "Cleanup must reject foreign pointers and remove only owned manifests");
assert(circleci.includes("npm run semantic:e2e:storage-publication"),
  "Storage publication rehearsal must only run in manual CircleCI Testing job");
const fullRehearsal=readFileSync("scripts/semantic-testing-full-e2e.ts","utf8");
assert(fullRehearsal.includes('SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY"'),
  "Canonical-to-canary rehearsal must require explicit Testing approval");
assert(fullRehearsal.includes('url.pathname!=="/"+dbName'),
  "Canonical-to-canary rehearsal must refuse all other databases");
assert(fullRehearsal.includes("await snapshotEmployer(employerId,period)") &&
  fullRehearsal.includes("await readPublishedSemanticPartition(key)") &&
  fullRehearsal.includes("await readSemanticPublicationChanges("),
  "Full rehearsal must bridge real score rebuild, published canary read and version feed");
assert(fullRehearsal.includes("assert.notEqual(revised.score,baseline.score") &&
  fullRehearsal.includes("rollbackSemanticPublication({"),
  "Full rehearsal must verify a genuine score delta and rollback");
assert(fullRehearsal.includes('url.hostname!=="testing-e2e.example.invalid"') &&
  fullRehearsal.includes("globalThis.fetch=async(input,init)=>"),
  "Full rehearsal must intercept only synthetic S3 requests");
assert(fullRehearsal.includes("externalDurabilityVerified:false") &&
  fullRehearsal.includes("browserWithRealApiTested:false"),
  "Integration must not misrepresent emulated storage or browser results");
assert(fullRehearsal.includes("where:{id:journeyId,monthlySavingCents:30000}") &&
  fullRehearsal.includes("await prisma.$disconnect()"),
  "Synthetic source must be restored and Neon client disconnected");
assert(circleci.includes("npm run semantic:e2e:canonical-to-canary") &&
  circleci.includes("context: newchanges-neon-testing"),
  "Full integration test must only run with manually authorized Testing credentials");
const readOnlyStorage=readFileSync("src/services/semanticRealStorageRead.ts","utf8");
const readOnlyCli=readFileSync("scripts/semantic-testing-real-storage-read.ts","utf8");
assert(readOnlyStorage.includes('SEMANTIC_STORAGE_READ_APPROVED!=="YES_TESTING_READ_ONLY"') &&
  readOnlyStorage.includes("SEMANTIC_VERIFY_ALLOWED_HOST") &&
  readOnlyStorage.includes("identified as Testing") &&
  readOnlyStorage.includes("existing synthetic Testing object key"),
  "Real storage verifier must refuse unknown hosts, non-Testing buckets and non-synthetic keys");
assert(readOnlyStorage.includes('presignS3Request({method:"GET"') &&
  !readOnlyStorage.includes('presignS3Request({method:"PUT"') &&
  !readOnlyStorage.includes('presignS3Request({method:"DELETE"'),
  "Real storage verification must be strictly read-only");
assert(readOnlyCli.includes("verifyExistingSemanticObjectRead(process.env)") &&
  !readOnlyCli.includes("ENABLE_SEMANTIC_OBJECT_PUBLISH"),
  "Real storage CLI must never enable semantic publication");
const notifyProbe=readFileSync("scripts/semantic-testing-notify-probe.ts","utf8");
const notifyMeasure=readFileSync("src/services/semanticNotificationDelivery.ts","utf8");
assert(notifyProbe.includes('SEMANTIC_NOTIFY_PROBE_APPROVED!=="YES_TEST_ONLY"') &&
  notifyProbe.includes('SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY"'),
  "LISTEN probe requires two explicit Testing approvals");
assert(notifyProbe.includes('u.pathname!=="/"+database') &&
  notifyProbe.includes("semanticListenerConnectionString({"),
  "LISTEN probe must reject non-Testing databases and pooled listener URLs");
assert(notifyProbe.includes('diagnosticChannel="newchanges_semantic_testing_probe"') &&
  notifyProbe.includes("maxSamples=3") &&
  !notifyProbe.includes('enqueueSemanticRefresh(') &&
  !notifyProbe.includes('processOneShadowSemanticRefresh('),
  "LISTEN probe must be short-lived and never mutate or drain the application queue");
assert(notifyMeasure.includes("input.receiver.on") &&
  notifyMeasure.includes("input.receiver.off") &&
  notifyMeasure.includes("setTimeout("),
  "Notification measurement must listen before publish and release handlers on timeout");
assert(circleci.includes("semantic_notify_probe:") &&
  circleci.includes("<< pipeline.parameters.semantic_notify_probe >>") &&
  circleci.includes("context: newchanges-neon-testing") &&
  circleci.includes("npm run semantic:e2e:notify-probe"),
  "Short-lived database notification probe must be separately manually gated");
assert(circleci.includes('if [ -z "${SEMANTIC_TESTING_DATABASE_URL:-}" ] || [ -z "${SEMANTIC_LISTEN_DATABASE_URL:-}" ]'),
  "Testing notification job must require both pooled and direct Neon secrets");
console.log("Isolated Neon synthetic fixture and score-delta runner safety assertions passed");
