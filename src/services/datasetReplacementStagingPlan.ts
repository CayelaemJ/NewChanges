import { createHash } from "node:crypto";
import { inspectReplacementFeedBudget, type ReplacementFeedEstimate, type ReplacementBudget } from "./datasetReplacementFeedBudget.js";
import { assessReplacementEvidence, type ReplacementEvidence } from "./datasetReplacementApproval.js";

// Pure dry-run staging contract. No production access or data mutation.
export interface StagingPlanInput {
  sourceFingerprint:string;
  currentFingerprint:string;
  feeds:ReplacementFeedEstimate[];
  budget:ReplacementBudget;
  existingEmployerIds:string[];
  incomingEmployerIds:string[];
  employerMapping:Record<string,string>;
  evidence:Partial<ReplacementEvidence>;
}
export function planReplacementStaging(input:StagingPlanInput) {
  const issues:string[]=[];
  if(!/^[a-f0-9]{64}$/i.test(input.sourceFingerprint)||!/^[a-f0-9]{64}$/i.test(input.currentFingerprint))
    issues.push("Both source fingerprints must be SHA-256 hashes");
  if(input.sourceFingerprint===input.currentFingerprint)
    issues.push("New source must differ from current reporting source");
  const budget=inspectReplacementFeedBudget(input.feeds,input.budget);
  issues.push(...budget.issues);
  const existing=new Set(input.existingEmployerIds),incoming=new Set(input.incomingEmployerIds);
  if(existing.size!==input.existingEmployerIds.length||incoming.size!==input.incomingEmployerIds.length)
    issues.push("Duplicate employer identity in source inventory");
  if([...existing,...incoming].some(id=>!id.trim()))issues.push("Blank employer identity");
  const targets=new Set<string>();
  for(const [oldId,newId] of Object.entries(input.employerMapping)){
    if(!existing.has(oldId)||!incoming.has(newId))issues.push("Unrecognized employer mapping");
    if(targets.has(newId))issues.push("Many-to-one employer mapping requires explicit resolution");
    targets.add(newId);
  }
  // Collisions are never auto-treated as the same tenant. Mapping must be explicit.
  const collisions=[...incoming].filter(id=>existing.has(id) && input.employerMapping[id]!==id);
  if(collisions.length)issues.push("Employer identifiers overlap across different source generations without approved mapping");
  const approval=assessReplacementEvidence(input.evidence);
  return {
    validForStagingReview:issues.length===0,
    issues,missingApprovalEvidence:approval.missing,
    sourceRows:budget.totalRows,employersToReconcile:existing.size,
    incomingEmployers:incoming.size,
    planDigest:createHash("sha256").update(JSON.stringify({
      sourceFingerprint:input.sourceFingerprint,feeds:input.feeds.map(x=>[x.reportKey,x.rowCount,x.sourceWatermark]).sort(),
      mapping:Object.entries(input.employerMapping).sort(),budget:input.budget,
    })).digest("hex"),
    executionEnabled:false as const,
    note:"Planning is read-only. Staging, data cleanup and publication require separate audited execution and tested rollback.",
  };
}
