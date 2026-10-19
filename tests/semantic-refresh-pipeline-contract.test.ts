import assert from "node:assert/strict";
import { partitionsFromCanonicalSourceRows, mergeAndExpandSemanticPartitions } from "../src/services/semanticSourceChangePlanner.js";
import { assessShadowSemanticProvenance } from "../src/services/semanticShadowProvenance.js";
import { evaluatePublicationGates } from "../src/services/semanticPublicationGates.js";
import { LOAD_ORDER } from "../src/services/reportFormats.js";

// Isolated pipeline CONTRACT rehearsal. Deliberately no database, storage credentials,
// production scores or real publication. A live integration test is still required.
const changedRows = [{
  employer_ref: "VIG",
  observed_at: "2026-03-31",
  source_updated_at: "2026-10-19T10:00:00Z",
  is_deleted: true,
}];
const dirty = partitionsFromCanonicalSourceRows("debt_accounts", changedRows);
assert.deepEqual(dirty, [{
  employerId: "VIG", period: "2026-03", feeds: ["debt_accounts"], deleted: true,
}]);
const work = mergeAndExpandSemanticPartitions(dirty, "2026-10");
assert.equal(work.length, 8, "Retroactive correction must invalidate all later snapshots");
assert(work.every(p => p.deleted && p.feeds.includes("debt_accounts")));

const fingerprint = "a".repeat(64);
const proven = {
  recomputeEnabled: true, generationId: "fixture-generation",
  generationState: "ACTIVE", generationFingerprint: fingerprint,
  activeSourceFingerprint: fingerprint, validatedAt: new Date("2026-10-19T10:00:00Z"),
};
assert.equal(assessShadowSemanticProvenance(proven).allowed, true);
assert.equal(assessShadowSemanticProvenance({...proven, recomputeEnabled: false}).allowed, false,
  "Published-copy mode must not masquerade as recalculated scores");
assert.equal(assessShadowSemanticProvenance({...proven, activeSourceFingerprint: "b".repeat(64)}).allowed, false,
  "Changed or unapproved source must fail closed");
assert.equal(assessShadowSemanticProvenance({...proven, generationState: "STAGED"}).allowed, false,
  "Unactivated source must fail closed");

const now = new Date("2026-10-19T10:00:00Z");
const goodGates = {sourceValidated:true,reconciledFeeds:[...LOAD_ORDER],storageVerified:true,
  sha256Verified:true,partitionNonempty:true,watermark:new Date("2026-10-19T09:59:30Z"),now};
assert.equal(evaluatePublicationGates(goodGates).ready,true,"All ten reconciled feeds and verified object may publish");
assert.equal(evaluatePublicationGates({...goodGates,reconciledFeeds:LOAD_ORDER.slice(0,-1)}).ready,false,
  "Missing one canonical feed blocks snapshot publication");
assert.equal(evaluatePublicationGates({...goodGates,sha256Verified:false}).ready,false,
  "Object digest mismatch blocks snapshot publication");
assert.equal(evaluatePublicationGates({...goodGates,watermark:new Date("2026-10-18T09:00:00Z")}).ready,false,
  "Stale source watermark blocks publication");
assert.equal(evaluatePublicationGates({...goodGates,watermark:new Date("2026-10-20T09:00:00Z")}).ready,false,
  "Future source watermark blocks publication");

// Source change -> dependency expansion -> provenance gate and publication gate are covered.
// Durable ingestion, actual score recomputation, publication and browser refresh
// MUST be tested using isolated live services before production signoff.
console.log("Isolated semantic refresh pipeline contract passed (not live E2E)");
