import assert from "node:assert/strict";
import {assessShadowSemanticProvenance} from "../src/services/semanticShadowProvenance.js";
const fingerprint="b".repeat(64);
const base={recomputeEnabled:true,generationId:"g1",generationState:"ACTIVE",generationFingerprint:fingerprint,
  activeSourceFingerprint:fingerprint,validatedAt:new Date()};
assert.equal(assessShadowSemanticProvenance(base).allowed,true);
for(const change of [
 {recomputeEnabled:false},{generationState:"VALIDATED"},{generationState:null},
 {generationFingerprint:"a".repeat(64)},{activeSourceFingerprint:"a".repeat(64)},
 {validatedAt:null},{generationId:""}
]) assert.equal(assessShadowSemanticProvenance({...base,...change}).allowed,false,JSON.stringify(change));
console.log("Semantic shadow source provenance checks passed");
