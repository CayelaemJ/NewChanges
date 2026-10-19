import assert from "node:assert/strict";
import { partitionsFromCanonicalSourceRows, mergeAndExpandSemanticPartitions } from "../src/services/semanticSourceChangePlanner.js";
import { assessShadowSemanticProvenance } from "../src/services/semanticShadowProvenance.js";

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

// Source change -> dependency expansion -> provenance gate is covered.
// Durable ingestion, actual score recomputation, publication and browser refresh
// MUST be tested using isolated live services before production signoff.
console.log("Isolated semantic refresh pipeline contract passed (not live E2E)");
