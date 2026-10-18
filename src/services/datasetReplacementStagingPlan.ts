import { createHash } from "node:crypto";
import { reviewTenFeedTransferBudget, type FeedTransferEstimate, type TransferCaps } from "./datasetReplacementTransferBudget.js";
import { inspectReplacementFeedBudget, type ReplacementFeedEstimate, type ReplacementBudget } from "./datasetReplacementFeedBudget.js";
import { assessReplacementEvidence, type ReplacementEvidence } from "./datasetReplacementApproval.js";

// Pure dry-run staging contract. No production access or data mutation.
export interface StagingPlanInput {
  sourceFingerprint:string;
  currentFingerprint:string;
  feeds:ReplacementFeedEstimate[];
  budget:ReplacementBudget;
  transferEstimate?:{feeds:FeedTransferEstimate[];caps:TransferCaps};
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
  const transfer=input.transferEstimate?reviewTenFeedTransferBudget(input.transferEstimate.feeds,input.transferEstimate.caps):null;
  if(transfer)issues.push(...transfer.issues);
  const existing=new Set(input.existingEmployerIds),incoming=new Set(input.incomingEmployerIds);
  if(existing.size!==input.existingEmployerIds.length||incoming.size!==input.incomingEmployerIds.length)
    issues.push("Duplicate employer identity in source inventory");
  if([...existing,...incoming].some(id=>!id.trim()))issues.push("Blank employer identity");
  const targets=new Set<string>();
  // A new dataset cannot silently strand historical employer permissions.
  // Every retained employer must have an explicit mapping; revocations need a separate reviewed workflow.
  for(const oldId of existing) {
    if(!Object.prototype.hasOwnProperty.call(input.employerMapping,oldId))
      issues.push("Unreconciled existing employer requires mapping or reviewed revocation");
  }
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
    sourceRows:budget.totalRows,transferBudget:transfer,employersToReconcile:existing.size,
    incomingEmployers:incoming.size,
    planDigest:createHash("sha256").update(JSON.stringify({
      sourceFingerprint:input.sourceFingerprint,currentFingerprint:input.currentFingerprint,
      existingEmployers:[...input.existingEmployerIds].sort(),incomingEmployers:[...input.incomingEmployerIds].sort(),
      feeds:input.feeds.map(x=>[x.reportKey,x.rowCount,x.sourceWatermark]).sort(),
      mapping:Object.entries(input.employerMapping).sort(),budget:input.budget,
      transferEstimate:input.transferEstimate??null,
    })).digest("hex"),
    executionEnabled:false as const,
    note:"Planning is read-only. Staging, data cleanup and publication require separate audited execution and tested rollback.",
  };
}
