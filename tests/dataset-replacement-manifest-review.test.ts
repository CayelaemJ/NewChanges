import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {CANONICAL_REPLACEMENT_FEEDS} from "../src/services/datasetReplacementStaging.js";
import {reviewReplacementManifest} from "../src/services/datasetReplacementManifestReview.js";
const generationId="g2",sourceFingerprint="a".repeat(64),activeSourceFingerprint="b".repeat(64);
const bytes=Buffer.from('{"rows":[]}'),digest=createHash("sha256").update(bytes).digest("hex");
const objects=CANONICAL_REPLACEMENT_FEEDS.map(feed=>({
 feed,generationId,sourceFingerprint,objectKey:`staging/${generationId}/${sourceFingerprint}/${feed}/${digest}.json`,
 expectedSha256:digest,expectedBytes:bytes.length,rowCount:0,content:bytes,
}));
const baseline={generationId,sourceFingerprint,activeSourceFingerprint,
 namespace:`staging/${generationId}/${sourceFingerprint}`,objects};
assert.equal(reviewReplacementManifest(baseline).readyForStagingReview,true);
assert.equal(reviewReplacementManifest(baseline).replacementEnabled,false);
assert.equal(reviewReplacementManifest({...baseline,objects:objects.slice(1)}).readyForStagingReview,false);
assert.equal(reviewReplacementManifest({...baseline,objects:[...objects,objects[0]]}).readyForStagingReview,false);
assert.equal(reviewReplacementManifest({...baseline,objects:objects.map((o,i)=>i?o:{...o,content:Buffer.from("corrupt")})}).readyForStagingReview,false);
assert.equal(reviewReplacementManifest({...baseline,objects:objects.map((o,i)=>i?o:{...o,generationId:"foreign"})}).readyForStagingReview,false);
assert.equal(reviewReplacementManifest({...baseline,activeSourceFingerprint:sourceFingerprint}).readyForStagingReview,false);
console.log("Replacement aggregate manifest integrity checks passed");
