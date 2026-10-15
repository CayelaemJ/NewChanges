// Fail-closed provenance contract for the generation-isolated replacement path.
// This module performs no I/O and never changes an active source or dashboard.
export const CANONICAL_REPLACEMENT_FEEDS = [
  "employers","workforce_snapshots","employees","platform_users","journeys",
  "debt_accounts","policies","ratings","referrals","salary_advances",
] as const;
export type ReplacementFeed = typeof CANONICAL_REPLACEMENT_FEEDS[number];
export interface StagedFeedEvidence {
  feed:ReplacementFeed;
  generationId:string;
  sourceFingerprint:string;
  rowCount:number;
  checksumSha256:string;
  validated:boolean;
}
export interface StagedReplacementEvidence {
  generationId:string;
  sourceFingerprint:string;
  activeSourceFingerprint:string;
  namespace:string;
  feeds:readonly StagedFeedEvidence[];
}
const sha=/^[a-f0-9]{64}$/;
const safeId=/^[a-zA-Z0-9_-]{1,128}$/;
/** Returns a deterministic validation result, never permission to delete or publish. */
export function validateIsolatedReplacementStage(input:StagedReplacementEvidence) {
  const errors:string[]=[];
  if (!safeId.test(input.generationId)) errors.push("invalid generation ID");
  if (!sha.test(input.sourceFingerprint)||!sha.test(input.activeSourceFingerprint))
    errors.push("invalid source fingerprints");
  if (input.sourceFingerprint===input.activeSourceFingerprint)
    errors.push("candidate is the active source");
  if (input.namespace!==`staging/${input.generationId}/${input.sourceFingerprint}`)
    errors.push("staging namespace is not generation isolated");
  const seen=new Set<string>();
  for(const feed of input.feeds) {
    if(seen.has(feed.feed)) errors.push(`duplicate feed: ${feed.feed}`);
    seen.add(feed.feed);
    if(!CANONICAL_REPLACEMENT_FEEDS.includes(feed.feed))
      errors.push(`unknown feed: ${feed.feed}`);
    if(feed.generationId!==input.generationId || feed.sourceFingerprint!==input.sourceFingerprint)
      errors.push(`foreign source lineage: ${feed.feed}`);
    if(!Number.isSafeInteger(feed.rowCount)||feed.rowCount<0)
      errors.push(`invalid row count: ${feed.feed}`);
    if(!sha.test(feed.checksumSha256)||feed.validated!==true)
      errors.push(`unverified feed: ${feed.feed}`);
  }
  for(const feed of CANONICAL_REPLACEMENT_FEEDS)
    if(!seen.has(feed)) errors.push(`missing feed: ${feed}`);
  return {readyForStagingReview:errors.length===0,errors,publicationEnabled:false as const,
    replacementEnabled:false as const};
}
