// Read-only aggregate verification of staged replacement objects.
// All object bytes must be obtained from a trusted storage GET by the caller.
import {verifyReplacementObject,type ReplacementObjectProof} from "./datasetReplacementObjectIntegrity.js";
import {validateIsolatedReplacementStage} from "./datasetReplacementStaging.js";
export interface ReplacementManifestReview {
  generationId:string;
  sourceFingerprint:string;
  activeSourceFingerprint:string;
  namespace:string;
  objects:readonly ReplacementObjectProof[];
}
export function reviewReplacementManifest(input:ReplacementManifestReview) {
  const issues:string[]=[];
  const feeds=[] as ReturnType<typeof verifyReplacementObject>[];
  for(const object of input.objects) {
    try {
      if(object.generationId!==input.generationId || object.sourceFingerprint!==input.sourceFingerprint)
        throw new Error("object belongs to another source generation");
      feeds.push(verifyReplacementObject(object));
    } catch(error) {
      issues.push(`${String(object.feed)}: ${error instanceof Error?error.message:String(error)}`);
    }
  }
  const stage=validateIsolatedReplacementStage({
    generationId:input.generationId,sourceFingerprint:input.sourceFingerprint,
    activeSourceFingerprint:input.activeSourceFingerprint,namespace:input.namespace,feeds,
  });
  issues.push(...stage.errors);
  return {readyForStagingReview:issues.length===0,issues,
    checkedObjects:feeds.length,publicationEnabled:false as const,replacementEnabled:false as const};
}
