// A pure, fail-closed safety decision for unrelated dataset replacement.
// A preview is NEVER authorization to delete/import data.
export interface ReplacementEvidence {
  candidateDifferentSource:boolean;
  tenFeedValidation:boolean;
  backupRestoreRehearsed:boolean;
  accessMappingsReviewed:boolean;
  ingestionStopped:boolean;
  stagingAndAtomicPublishProven:boolean;
  isolatedPlaygroundRehearsal:boolean;
}
export const REPLACEMENT_REQUIREMENTS = [
  "candidateDifferentSource","tenFeedValidation","backupRestoreRehearsed",
  "accessMappingsReviewed","ingestionStopped","stagingAndAtomicPublishProven",
  "isolatedPlaygroundRehearsal",
] as const;
export function assessReplacementEvidence(value:Partial<ReplacementEvidence>) {
  const missing=REPLACEMENT_REQUIREMENTS.filter(key=>value[key]!==true);
  return {readyForOperatorReview:missing.length===0,missing,executionEnabled:false as const,
    note:"Readiness checks never execute replacement. A separate audited operation and explicit confirmation are required."};
}
