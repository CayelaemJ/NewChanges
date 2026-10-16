// Storage-backed, read-only staging review. The caller injects an authenticated,
// trusted object-store GET; this module never signs arbitrary URLs or writes data.
import {reviewReplacementManifest,type ReplacementManifestReview} from "./datasetReplacementManifestReview.js";
import type {ReplacementObjectProof} from "./datasetReplacementObjectIntegrity.js";
type ObjectMetadata=Omit<ReplacementObjectProof,"content">;
export type TrustedObjectReader=(key:string)=>Promise<Uint8Array>;
export async function reviewStoredReplacementManifest(
  input:Omit<ReplacementManifestReview,"objects"> & {objects:readonly ObjectMetadata[]},
  readObject:TrustedObjectReader,
) {
  const issues:string[]=[];
  if(input.objects.length!==10)
    return {readyForStagingReview:false,issues:["expected exactly ten staged objects"],checkedObjects:0,publicationEnabled:false as const,replacementEnabled:false as const};
  const verified:ReplacementObjectProof[]=[];
  // Check metadata before I/O; never read an untrusted or foreign namespace.
  for(const object of input.objects) {
    const prefix=`staging/${input.generationId}/${input.sourceFingerprint}/${object.feed}/`;
    if(object.generationId!==input.generationId || object.sourceFingerprint!==input.sourceFingerprint ||
       !object.objectKey.startsWith(prefix) || object.objectKey.includes("..") ||
       !/^[a-f0-9]{64}\.json$/.test(object.objectKey.slice(prefix.length)) ||
       !Number.isSafeInteger(object.expectedBytes) || object.expectedBytes<1 || object.expectedBytes>64*1024*1024) {
      issues.push(`${object.feed}: rejected untrusted object metadata`);
    }
  }
  if(issues.length)return {readyForStagingReview:false,issues,checkedObjects:0,publicationEnabled:false as const,replacementEnabled:false as const};
  for(const object of input.objects) {
    try {
      const content=await readObject(object.objectKey);
      if(!(content instanceof Uint8Array))throw new Error("storage read returned invalid bytes");
      if(content.byteLength!==object.expectedBytes)throw new Error("storage read length mismatch");
      verified.push({...object,content});
    } catch(error) {
      issues.push(`${object.feed}: ${error instanceof Error?error.message:String(error)}`);
    }
  }
  const result=reviewReplacementManifest({...input,objects:verified});
  return {...result,issues:[...issues,...result.issues],
    readyForStagingReview:issues.length===0 && result.readyForStagingReview};
}
