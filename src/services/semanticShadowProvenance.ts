// Prevent labeling stale dashboard copies as snapshots from a new source.
// Called before any semantic payload read or object upload.
export function assessShadowSemanticProvenance(input:{
  recomputeEnabled:boolean;
  generationId:string;
  generationState:string|null;
  generationFingerprint:string|null;
  activeSourceFingerprint:string;
  validatedAt:Date|null;
}) {
  const missing:string[]=[];
  if(!input.recomputeEnabled) missing.push("source-specific recomputation is disabled");
  if(!input.generationId || input.generationState!=="ACTIVE" || !input.validatedAt)
    missing.push("job source generation is not active and validated");
  if(!/^[a-f0-9]{64}$/.test(input.activeSourceFingerprint) ||
     !input.generationFingerprint ||
     input.generationFingerprint!==input.activeSourceFingerprint)
    missing.push("job source differs from the configured active source");
  return {allowed:missing.length===0,missing};
}
