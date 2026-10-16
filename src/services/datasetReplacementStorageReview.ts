// Storage-backed, read-only staging review. The caller injects an authenticated,
// trusted object-store GET; this module never signs arbitrary URLs or writes data.
import type {ReplacementManifestReview} from "./datasetReplacementManifestReview.js";
import {CANONICAL_REPLACEMENT_FEEDS,validateIsolatedReplacementStage} from "./datasetReplacementStaging.js";
import {verifyReplacementObject} from "./datasetReplacementObjectIntegrity.js";
import type {ReplacementObjectProof} from "./datasetReplacementObjectIntegrity.js";
type ObjectMetadata=Omit<ReplacementObjectProof,"content">;
export type TrustedObjectReader=(key:string)=>Promise<Uint8Array>;
// Hard ceiling prevents callers from disabling bounded staging inspection.
export const MAX_STAGING_REVIEW_BYTES=128*1024*1024;
export const DEFAULT_STAGING_REVIEW_BYTES=64*1024*1024;
export async function reviewStoredReplacementManifest(
  input:Omit<ReplacementManifestReview,"objects"> & {objects:readonly ObjectMetadata[]},
  readObject:TrustedObjectReader,
  maxTotalBytes=DEFAULT_STAGING_REVIEW_BYTES,
) {
  const issues:string[]=[];
  if(input.objects.length!==10)
    return {readyForStagingReview:false,issues:["expected exactly ten staged objects"],checkedObjects:0,publicationEnabled:false as const,replacementEnabled:false as const};
  if(!Number.isSafeInteger(maxTotalBytes)||maxTotalBytes<1||maxTotalBytes>MAX_STAGING_REVIEW_BYTES)
    issues.push("invalid aggregate byte budget");
  let totalBytes=0;
  const expectedNamespace=`staging/${input.generationId}/${input.sourceFingerprint}`;
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(input.generationId) ||
     !/^[a-f0-9]{64}$/.test(input.sourceFingerprint) ||
     !/^[a-f0-9]{64}$/.test(input.activeSourceFingerprint) ||
     input.sourceFingerprint===input.activeSourceFingerprint ||
     input.namespace!==expectedNamespace)
    issues.push("invalid or non-isolated replacement source identity");
  const feeds=new Set<string>();
  const objectKeys=new Set<string>();
  for(const object of input.objects) {
    if(!CANONICAL_REPLACEMENT_FEEDS.includes(object.feed))issues.push(`${object.feed}: noncanonical feed`);
    if(feeds.has(object.feed))issues.push(`${object.feed}: duplicate feed`);
    feeds.add(object.feed);
    if(objectKeys.has(object.objectKey))issues.push(`${object.feed}: duplicate object key`);
    objectKeys.add(object.objectKey);
    if(!Number.isSafeInteger(object.rowCount) || object.rowCount<0)
      issues.push(`${object.feed}: invalid row count`);
    if(Number.isSafeInteger(object.expectedBytes)&&object.expectedBytes>0){
      totalBytes+=object.expectedBytes;
      if(!Number.isSafeInteger(totalBytes)||totalBytes>maxTotalBytes)
        issues.push("aggregate staging byte budget exceeded");
    }
    if(!/^[a-f0-9]{64}$/.test(object.expectedSha256))
      issues.push(`${object.feed}: invalid declared checksum`);
  }
  for(const feed of CANONICAL_REPLACEMENT_FEEDS)
    if(!feeds.has(feed))issues.push(`${feed}: missing feed`);
  // Check metadata before I/O; never read an untrusted or foreign namespace.
  for(const object of input.objects) {
    const prefix=`staging/${input.generationId}/${input.sourceFingerprint}/${object.feed}/`;
    if(object.generationId!==input.generationId || object.sourceFingerprint!==input.sourceFingerprint ||
       !object.objectKey.startsWith(prefix) || object.objectKey.includes("..") ||
       !/^[a-f0-9]{64}\.json$/.test(object.objectKey.slice(prefix.length)) ||
       object.objectKey.slice(prefix.length)!==`${object.expectedSha256}.json` ||
       !Number.isSafeInteger(object.expectedBytes) || object.expectedBytes<1 || object.expectedBytes>64*1024*1024) {
      issues.push(`${object.feed}: rejected untrusted object metadata`);
    }
  }
  if(issues.length)return {readyForStagingReview:false,issues,checkedObjects:0,publicationEnabled:false as const,replacementEnabled:false as const};
  // Verify and discard each object before reading the next: at most one object buffered.
  // The final review uses independently verified, compact evidence rather than retaining all bytes.
  const evidence=[] as ReturnType<typeof verifyReplacementObject>[];
  for(const object of input.objects) {
    try {
      const content=await readObject(object.objectKey);
      if(!(content instanceof Uint8Array))throw new Error("storage read returned invalid bytes");
      if(content.byteLength!==object.expectedBytes)throw new Error("storage read length mismatch");
      evidence.push(verifyReplacementObject({...object,content}));
    } catch(error) {
      issues.push(`${object.feed}: ${error instanceof Error?error.message:String(error)}`);
      break;
    }
  }
  if(issues.length)return {readyForStagingReview:false,issues,checkedObjects:evidence.length,
    publicationEnabled:false as const,replacementEnabled:false as const};
  const stage=validateIsolatedReplacementStage({...input,feeds:evidence});
  return {readyForStagingReview:stage.readyForStagingReview,issues:stage.errors,
    checkedObjects:evidence.length,publicationEnabled:false as const,replacementEnabled:false as const};
}
