import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {CANONICAL_REPLACEMENT_FEEDS} from "../src/services/datasetReplacementStaging.js";
import {reviewStoredReplacementManifest} from "../src/services/datasetReplacementStorageReview.js";
const generationId="g1",sourceFingerprint="a".repeat(64),activeSourceFingerprint="b".repeat(64);
const content=Buffer.from('{"rows":[]}'),digest=createHash("sha256").update(content).digest("hex");
const objects=CANONICAL_REPLACEMENT_FEEDS.map(feed=>({feed,generationId,sourceFingerprint,
 objectKey:`staging/${generationId}/${sourceFingerprint}/${feed}/${digest}.json`,
 expectedSha256:digest,expectedBytes:content.byteLength,rowCount:0}));
const input={generationId,sourceFingerprint,activeSourceFingerprint,
 namespace:`staging/${generationId}/${sourceFingerprint}`,objects};
let count=0;
const reader=async (_key:string)=>{count++;return content;};
assert.equal((await reviewStoredReplacementManifest(input,reader)).readyForStagingReview,true);
assert.equal(count,10);
count=0;
assert.equal((await reviewStoredReplacementManifest({...input,objects:objects.slice(1)},reader)).readyForStagingReview,false);
assert.equal(count,0,"no incomplete manifest should fetch data");
count=0;
assert.equal((await reviewStoredReplacementManifest({...input,objects:objects.map((o,i)=>i?o:{...o,objectKey:"production/x.json"})},reader)).readyForStagingReview,false);
assert.equal(count,0,"foreign keys must never be fetched");
assert.equal((await reviewStoredReplacementManifest(input,async()=>Buffer.from("invalid"))).readyForStagingReview,false);
assert.equal((await reviewStoredReplacementManifest(input,async()=>{throw new Error("unavailable")})).readyForStagingReview,false);
console.log("Trusted staged storage readback checks passed");
