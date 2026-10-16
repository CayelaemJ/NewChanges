import assert from "node:assert/strict";
import {mkdtemp,mkdir,writeFile,symlink,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,dirname} from "node:path";
import {createHash} from "node:crypto";
import {CANONICAL_REPLACEMENT_FEEDS} from "../src/services/datasetReplacementStaging.js";
import {reviewStoredReplacementManifest} from "../src/services/datasetReplacementStorageReview.js";
import {createPlaygroundFileObjectReader} from "../src/services/datasetReplacementPlaygroundStore.js";
const root=await mkdtemp(join(tmpdir(),"newchanges-playground-"));
const generationId="playground",sourceFingerprint="a".repeat(64),activeSourceFingerprint="b".repeat(64);
const content=Buffer.from('{"rows":[]}');
const hash=createHash("sha256").update(content).digest("hex");
const objects=CANONICAL_REPLACEMENT_FEEDS.map(feed=>({feed,generationId,sourceFingerprint,
 objectKey:`staging/${generationId}/${sourceFingerprint}/${feed}/${hash}.json`,
 expectedSha256:hash,expectedBytes:content.length,rowCount:0}));
const input={generationId,sourceFingerprint,activeSourceFingerprint,
 namespace:`staging/${generationId}/${sourceFingerprint}`,objects};
try {
  for(const obj of objects) {
    const path=join(root,obj.objectKey);
    await mkdir(dirname(path),{recursive:true});
    await writeFile(path,content);
  }
  const reader=createPlaygroundFileObjectReader(root);
  assert.equal((await reviewStoredReplacementManifest(input,reader)).readyForStagingReview,true);
  const missing=join(root,objects[2].objectKey);
  await rm(missing);
  assert.equal((await reviewStoredReplacementManifest(input,reader)).readyForStagingReview,false);
  await writeFile(missing,Buffer.from(content.map((byte,i)=>i===0?byte^1:byte)));
  assert.equal((await reviewStoredReplacementManifest(input,reader)).readyForStagingReview,false);
  await rm(missing);
  const outside=join(root,"outside.json");
  await writeFile(outside,content);
  await symlink(outside,missing);
  assert.equal((await reviewStoredReplacementManifest(input,reader)).readyForStagingReview,false);
  await assert.rejects(reader("../secrets.json"),/Invalid staged object key/);
  console.log("Playground disk readback, corruption, missing and symlink isolation passed");
} finally {
  await rm(root,{recursive:true,force:true});
}
