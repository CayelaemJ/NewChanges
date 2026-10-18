// Verify immutable per-feed staged bytes before allowing staging review.
// No database writes, source changes, or publication.
import {createHash} from "node:crypto";
import {CANONICAL_REPLACEMENT_FEEDS,type ReplacementFeed,type StagedFeedEvidence} from "./datasetReplacementStaging.js";
export interface ReplacementObjectProof {
  feed:ReplacementFeed;
  generationId:string;
  sourceFingerprint:string;
  objectKey:string;
  expectedSha256:string;
  expectedBytes:number;
  rowCount:number;
  content:Uint8Array;
}
const validId=/^[a-zA-Z0-9_-]{1,128}$/;
const validSha=/^[a-f0-9]{64}$/;
const MAX_BYTES=64*1024*1024;
export function verifyReplacementObject(input:ReplacementObjectProof):StagedFeedEvidence {
  if(!CANONICAL_REPLACEMENT_FEEDS.includes(input.feed)) throw new Error("Unknown canonical feed");
  if(!validId.test(input.generationId)||!validSha.test(input.sourceFingerprint)) throw new Error("Invalid source identity");
  if(!Number.isSafeInteger(input.rowCount)||input.rowCount<0) throw new Error("Invalid row count");
  if(!Number.isSafeInteger(input.expectedBytes)||input.expectedBytes<=0||input.expectedBytes>MAX_BYTES)
    throw new Error("Staged object exceeds bounded size");
  const prefix=`staging/${input.generationId}/${input.sourceFingerprint}/${input.feed}/`;
  if(!input.objectKey.startsWith(prefix)||!input.objectKey.endsWith(".json")||
     input.objectKey.includes("..")||input.objectKey.includes("//"))
    throw new Error("Staged object key lacks immutable source lineage");
  if(!validSha.test(input.expectedSha256)||input.content.byteLength!==input.expectedBytes)
    throw new Error("Staged object length or digest metadata invalid");
  const actual=createHash("sha256").update(input.content).digest("hex");
  if(actual!==input.expectedSha256) throw new Error("Staged object content digest mismatch");
  return {feed:input.feed,generationId:input.generationId,
    sourceFingerprint:input.sourceFingerprint,rowCount:input.rowCount,
    checksumSha256:actual,validated:true};
}
