/**
 * Bounded, process-local backstop against request bursts.
 * This is NOT a distributed limiter: multi-instance production deployments
 * require an upstream/shared-store enforcement layer as a separate release gate.
 */
export type RateDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number; reason: "limit" | "capacity" };

export class InMemoryRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();
  private lastCapacityPrune = -Infinity;

  constructor(private readonly maxBuckets = 100_000) {
    if (!Number.isSafeInteger(maxBuckets) || maxBuckets < 1) throw new Error("invalid rate-limit bucket capacity");
  }

  hit(key: string, limit: number, windowMs: number, now = Date.now()): RateDecision {
    if (!key || !Number.isSafeInteger(limit) || limit < 1 ||
      !Number.isSafeInteger(windowMs) || windowMs < 1 || !Number.isFinite(now)) {
      throw new Error("invalid rate-limit input");
    }
    const current = this.buckets.get(key);
    if (!current || current.resetAt <= now) {
      if (!current && this.buckets.size >= this.maxBuckets) {
        // Prevent unbounded work on each rejected new identity at capacity.
        if (now - this.lastCapacityPrune >= 1000) {
          this.pruneExpired(now);
          this.lastCapacityPrune = now;
        }
        if (this.buckets.size >= this.maxBuckets) {
          // Refuse previously unseen identities rather than exhausting RAM.
          return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000), reason: "capacity" };
        }
      }
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true };
    }
    current.count = Math.min(current.count + 1, limit + 1);
    if (current.count > limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)), reason: "limit" };
    }
    return { allowed: true };
  }

  pruneExpired(now = Date.now()): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }

  get size(): number { return this.buckets.size; }
}
