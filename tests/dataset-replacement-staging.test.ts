import assert from "node:assert/strict";
import {CANONICAL_REPLACEMENT_FEEDS,validateIsolatedReplacementStage} from "../src/services/datasetReplacementStaging.js";
const fingerprint="a".repeat(64), active="b".repeat(64), generationId="candidate_1";
const baseline={
  generationId,sourceFingerprint:fingerprint,activeSourceFingerprint:active,
  namespace:`staging/${generationId}/${fingerprint}`,
  feeds:CANONICAL_REPLACEMENT_FEEDS.map(feed=>({
    feed,generationId,sourceFingerprint:fingerprint,rowCount:0,checksumSha256:"c".repeat(64),validated:true
  }))
};
const assess=(patch:any)=>validateIsolatedReplacementStage({...baseline,...patch});
assert.equal(assess({}).readyForStagingReview,true);
assert.equal(assess({}).publicationEnabled,false);
assert.equal(assess({}).replacementEnabled,false);
for(const feed of CANONICAL_REPLACEMENT_FEEDS)
 assert(assess({feeds:baseline.feeds.filter(f=>f.feed!==feed)}).errors.includes(`missing feed: ${feed}`));
assert.equal(assess({activeSourceFingerprint:fingerprint}).readyForStagingReview,false);
assert.equal(assess({namespace:"production"}).readyForStagingReview,false);
assert.equal(assess({feeds:[...baseline.feeds,baseline.feeds[0]]}).readyForStagingReview,false);
assert.equal(assess({feeds:baseline.feeds.map((f,i)=>i?f:{...f,generationId:"other"})}).readyForStagingReview,false);
assert.equal(assess({feeds:baseline.feeds.map((f,i)=>i?f:{...f,validated:false})}).readyForStagingReview,false);
assert.equal(assess({feeds:baseline.feeds.map((f,i)=>i?f:{...f,rowCount:-1})}).readyForStagingReview,false);
console.log("Isolated replacement stage provenance checks passed");
