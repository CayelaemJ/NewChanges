/**
 * Pure, process-local CDC chart notification prototype.
 * Not a durable CDC cursor, queue, or cross-instance publication service.
 * No source rows, PII, MySQL credentials or PostgreSQL reporting writes.
 */
import { LOAD_ORDER } from "./reportFormats.js";
import { type FeedInvalidation, verifyFeedInvalidation } from "./mysqlCommittedFeedGenerations.js";

const ALLOWED = new Set<string>(LOAD_ORDER);
const NAMESPACE = /^[A-Za-z0-9_-]{1,128}$/;
const SOURCE_ID = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_SUBSCRIPTIONS = 200;
const MAX_LISTENERS_PER_SCOPE = 16;

export interface VerifiedChartSubscription {
  sourceId: string;
  tenantId: string;
  employerRef: string;
  authorizedEmployerRefs: readonly string[];
}

export interface VerifiedCdcChartChange {
  sourceId: string;
  tenantId: string;
  employerRef: string;
  feed: string;
  generation: number;
  /** The change must originate from a verified, committed binlog transaction. */
  committed: true;
}

export interface ChartInvalidation {
  type: "MYSQL_CHART_INVALIDATION";
  feed: string;
  generation: number;
}

function cleanId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= 200 && value === value.trim();
}
function key(sourceId: string, tenantId: string, employerRef: string): string {
  if (!NAMESPACE.test(sourceId) || !NAMESPACE.test(tenantId) || !cleanId(employerRef))
    throw new Error("CDC_CHART_SCOPE_INVALID");
  return JSON.stringify([sourceId, tenantId, employerRef]);
}

export function createChartInvalidationHub() {
  const listeners = new Map<string, Set<(event: ChartInvalidation)=>void>>();
  const generations = new Map<string, number>();
  const feedGenerations = new Map<string, number>();
  let totalListeners = 0;

  function subscribe(
    scope: VerifiedChartSubscription,
    handler: (event: ChartInvalidation)=>void,
  ): (()=>void) | null {
    if (typeof handler !== "function" ||
        !Array.isArray(scope.authorizedEmployerRefs) ||
        scope.authorizedEmployerRefs.length === 0 ||
        scope.authorizedEmployerRefs.length > 128 ||
        !scope.authorizedEmployerRefs.every(cleanId) ||
        !scope.authorizedEmployerRefs.includes(scope.employerRef))
      throw new Error("CDC_CHART_SUBSCRIBER_UNAUTHORIZED");
    const id = key(scope.sourceId, scope.tenantId, scope.employerRef);
    const set = listeners.get(id) ?? new Set();
    if (totalListeners >= MAX_SUBSCRIPTIONS ||
        set.size >= MAX_LISTENERS_PER_SCOPE) return null;
    if (set.has(handler)) throw new Error("CDC_CHART_DUPLICATE_HANDLER");
    set.add(handler);
    totalListeners++;
    listeners.set(id, set);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      set.delete(handler);
      totalListeners--;
      if (set.size === 0) {
        listeners.delete(id);
        for (const feed of ALLOWED) generations.delete(JSON.stringify([id, feed]));
        // Feed-wide generations are bounded to sources with active subscribers.
        if (![...listeners.keys()].some(k => JSON.parse(k)[0] === scope.sourceId)) {
          for (const feed of ALLOWED) feedGenerations.delete(JSON.stringify([scope.sourceId,feed]));
        }
      }
    };
  }

  function notify(change: VerifiedCdcChartChange): number {
    if (change.committed !== true || !ALLOWED.has(change.feed) ||
        !Number.isSafeInteger(change.generation) || change.generation < 1)
      throw new Error("CDC_CHART_UNVERIFIED_CHANGE");
    const id = key(change.sourceId, change.tenantId, change.employerRef);
    const generationKey = JSON.stringify([id, change.feed]);
    const previous = generations.get(generationKey) ?? 0;
    if (change.generation <= previous) return 0;
    // Process-local state is not a replacement for durable ordering.
    // Without subscribers, do not retain unbounded scope generation records.
    const subscribers = listeners.get(id);
    if (!subscribers?.size) return 0;
    if (generations.size >= MAX_SUBSCRIPTIONS * LOAD_ORDER.length &&
        !generations.has(generationKey))
      throw new Error("CDC_CHART_GENERATION_CAPACITY_EXCEEDED");
    generations.set(generationKey, change.generation);
    const message: ChartInvalidation = Object.freeze({
      type:"MYSQL_CHART_INVALIDATION",feed:change.feed,
      generation:change.generation,
    });
    for (const fn of subscribers) {
      try {fn(message);} catch {/* Listener failure is isolated. */}
    }
    return subscribers.size;
  }
  /**
   * Fan out a VERIFIED feed-wide invalidation, never an employer-specific
   * claim. Subscribers were already authorized for their own employer by the
   * Fastify SSE route; the event reveals only canonical feed + generation.
   * This is local fanout, NOT a durable cross-process notification service.
   */
  function notifyFeed(sourceId: string, event: FeedInvalidation): number {
    if (!SOURCE_ID.test(sourceId) || !verifyFeedInvalidation(event))
      throw new Error("CDC_CHART_FEED_EVENT_INVALID");
    const id=JSON.stringify([sourceId,event.feed]);
    const previous=feedGenerations.get(id)??0;
    if(event.generation<=previous) return 0;
    const affected=[...listeners.entries()]
      .filter(([k])=>JSON.parse(k)[0]===sourceId);
    if(!affected.length)return 0;
    if (feedGenerations.size >= MAX_SUBSCRIPTIONS * LOAD_ORDER.length &&
        !feedGenerations.has(id))
      throw new Error("CDC_CHART_FEED_GENERATION_CAPACITY_EXCEEDED");
    feedGenerations.set(id,event.generation);
    const notice:ChartInvalidation=Object.freeze({
      type:"MYSQL_CHART_INVALIDATION",feed:event.feed,
      generation:event.generation,
    });
    let count=0;
    for(const [,subscriberSet] of affected){
      for(const handler of subscriberSet){
        try{handler(notice);}catch{/* One disconnected browser cannot block others. */}
        count++;
      }
    }
    return count;
  }
  return {subscribe,notify,notifyFeed};
}
