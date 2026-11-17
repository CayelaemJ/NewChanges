/** 
 * Feed-wide CDC generations from an independently verified, durable source.
 *
 * The offline SQLite notification store tracks FEED generations, not employer
 * mappings. A table change can invalidate an entire feed, but MUST NOT be
 * represented as an employer-specific event. The server can fan out a public
 * feed name/generation to already-authenticated chart subscribers, who then
 * re-fetch their own authorized MySQL aggregates.
 *
 * This pure module does not read SQLite or PostgreSQL, open RDS connections,
 * or assert that a live CDC consumer exists.
 */
import { LOAD_ORDER } from "./reportFormats.js";

const FEEDS = new Set<string>(LOAD_ORDER);
const SOURCE = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_EVENTS = LOAD_ORDER.length;

export interface DurableFeedGenerations {
  readonly sourceId: string;
  /** Verified source checkpoint only; no inferred employer identity. */
  readonly checkpointGeneration: number;
  readonly feeds: Readonly<Record<string, number>>;
}
export interface FeedInvalidation {
  readonly type: "MYSQL_FEED_INVALIDATION";
  readonly feed: string;
  readonly generation: number;
}

/**
 * Pure change detector. Call ONLY after reading a durable, committed
 * generation snapshot from a trusted CDC notification store.
 * On any regression, unexpected feed or missing feed, fail closed.
 */
export function diffCommittedFeedGenerations(
  previous: DurableFeedGenerations,
  current: DurableFeedGenerations,
): readonly FeedInvalidation[] {
  function validate(snapshot: DurableFeedGenerations): void {
    if (!snapshot || !SOURCE.test(snapshot.sourceId) ||
        !Number.isSafeInteger(snapshot.checkpointGeneration) ||
        snapshot.checkpointGeneration < 0 || !snapshot.feeds ||
        typeof snapshot.feeds !== "object" ||
        Object.keys(snapshot.feeds).length !== FEEDS.size ||
        Object.keys(snapshot.feeds).some(feed=>!FEEDS.has(feed)) ||
        [...FEEDS].some(feed=>
          !Object.prototype.hasOwnProperty.call(snapshot.feeds,feed) ||
          !Number.isSafeInteger(snapshot.feeds[feed]) ||
          snapshot.feeds[feed] < 0 ||
          snapshot.feeds[feed] > snapshot.checkpointGeneration))
      throw new Error("CDC_FEED_GENERATION_SNAPSHOT_INVALID");
  }
  validate(previous);
  validate(current);
  if (previous.sourceId !== current.sourceId ||
      current.checkpointGeneration < previous.checkpointGeneration)
    throw new Error("CDC_FEED_GENERATION_SOURCE_OR_CHECKPOINT_REGRESSION");
  const output: FeedInvalidation[]=[];
  for(const feed of LOAD_ORDER){
    const old=previous.feeds[feed];
    const next=current.feeds[feed];
    if(next < old) throw new Error("CDC_FEED_GENERATION_REGRESSION");
    if(next > old) output.push(Object.freeze({
      type:"MYSQL_FEED_INVALIDATION",feed,generation:next,
    }));
  }
  if(output.length > MAX_EVENTS) throw new Error("CDC_FEED_GENERATION_BUDGET_EXCEEDED");
  if(current.checkpointGeneration===previous.checkpointGeneration &&
     output.length!==0)throw new Error("CDC_FEED_CHANGED_WITHOUT_COMMIT");
  return Object.freeze(output);
}

/** A feed-wide notice has no tenant/employer fields; consumers must reauthorize
 * every chart fetch. Do NOT convert this into VerifiedCdcChartChange. */
export function verifyFeedInvalidation(input: unknown): input is FeedInvalidation {
  if(!input || typeof input !== "object") return false;
  const obj=input as Record<string,unknown>;
  return Object.keys(obj).length===3 &&
    obj.type==="MYSQL_FEED_INVALIDATION" &&
    typeof obj.feed==="string" && FEEDS.has(obj.feed) &&
    Number.isSafeInteger(obj.generation) && Number(obj.generation)>0;
}
