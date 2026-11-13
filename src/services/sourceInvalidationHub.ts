/**
 * Process-local, bounded, tenant-scoped CDC invalidation notifications.
 *
 * Transport ONLY: does not connect to MySQL, read binlogs, or create CDC
 * checkpoints. A future durable MySQL consumer can call publish() AFTER
 * safely recording its checkpoint. Never put source-row data in events.
 *
 * Multi-replica deployments need an external fan-out/lease strategy; this
 * intentionally does not pretend in-memory events cross process boundaries.
 */
import { LOAD_ORDER } from "./reportFormats.js";

export type CanonicalFeed = typeof LOAD_ORDER[number];
export interface SourceChangeHint {
  feed: CanonicalFeed;
  employerRef: string;
  /** A YYYY-MM report partition. null means invalidate ALL employer periods. */
  period: string | null;
}
export interface SourceInvalidation {
  employerRef: string;
  /** null means the entire employer report family is potentially stale. */
  period: string | null;
  /** Opaque monotonically increasing version inside this process only. */
  version: string;
  feeds: CanonicalFeed[];
}

export interface SourceInvalidationHub {
  publish(hint: SourceChangeHint): boolean;
  subscribe(employerRef: string, callback: (notice: SourceInvalidation) => void): (() => void) | null;
  flush(): void;
  stop(): void;
  stats(): { pending: number; subscribers: number; dropped: number };
}

const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_PENDING = 1024;
const MAX_SUBSCRIBERS = 200;

function validateEmployerRef(value: string): void {
  if (typeof value !== "string" || !value.trim() || value.length > 128) {
    throw new Error("Invalid CDC employer scope");
  }
}
function validateHint(hint: SourceChangeHint): void {
  validateEmployerRef(hint.employerRef);
  if (!LOAD_ORDER.includes(hint.feed)) throw new Error("Unknown canonical CDC feed");
  if (hint.period !== null && !PERIOD.test(hint.period))
    throw new Error("Invalid CDC report period");
}

export function createSourceInvalidationHub(debounceMs = 1200): SourceInvalidationHub {
  if (!Number.isInteger(debounceMs) || debounceMs < 0 || debounceMs > 10_000)
    throw new Error("Invalid CDC debounce");
  const subscribers = new Map<string, Set<(notice: SourceInvalidation) => void>>();
  const pending = new Map<string, Set<CanonicalFeed>>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let sequence = 0;
  let dropped = 0;
  let stopped = false;
  const sep = "\u0000";

  function emit(employerRef: string, period: string | null, feeds: Set<CanonicalFeed>) {
    const listeners = subscribers.get(employerRef);
    if (!listeners?.size) return;
    const notice: SourceInvalidation = {
      employerRef, period, feeds: [...feeds], version: String(++sequence),
    };
    for (const fn of [...listeners]) {
      try { fn(notice); } catch { /* isolate SSE disconnects */ }
    }
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = undefined; }
    const values = [...pending.entries()];
    pending.clear();
    for (const [key, feeds] of values) {
      const split = key.indexOf(sep);
      emit(key.slice(0, split), key.slice(split + 1) || null, feeds);
    }
  }

  function publish(hint: SourceChangeHint): boolean {
    if (stopped) return false;
    validateHint(hint);
    if (!subscribers.has(hint.employerRef)) return true; // no browser listener
    const prefix = hint.employerRef + sep;
    let supersededFeeds: Set<CanonicalFeed> | null = null;
    if (hint.period === null) {
      // A tenant-wide invalidation supersedes all queued period entries,
      // retaining their feed hints for the browser's targeted fetch logic.
      supersededFeeds = new Set<CanonicalFeed>();
      for (const [key, feeds] of pending) {
        if (key.startsWith(prefix)) {
          feeds.forEach(feed => supersededFeeds!.add(feed));
          pending.delete(key);
        }
      }
    } else if (pending.has(prefix)) {
      // A previous broader change makes a narrower notification redundant.
      pending.get(prefix)!.add(hint.feed);
      return true;
    }
    const key = prefix + (hint.period ?? "");
    if (!pending.has(key) && pending.size >= MAX_PENDING) {
      // Overflow must NOT silently lose invalidations. Fold every pending
      // period for this employer into a tenant-wide invalidation.
      const feeds = new Set<CanonicalFeed>([hint.feed]);
      for (const [candidate, existing] of pending) {
        if (candidate.startsWith(prefix)) {
          existing.forEach(feed => feeds.add(feed));
          pending.delete(candidate);
        }
      }
      if (pending.size >= MAX_PENDING) {
        dropped++;
        // Explicit failure lets the caller trigger a durable full refresh or
        // close the stream; never claim a successfully published notification.
        return false;
      }
      pending.set(prefix, feeds);
    } else {
      if (!pending.has(key)) pending.set(key, new Set());
      pending.get(key)!.add(hint.feed);
      supersededFeeds?.forEach(feed => pending.get(key)!.add(feed));
    }
    if (!timer) {
      timer = setTimeout(flush, debounceMs);
      timer.unref?.();
    }
    return true;
  }

  function subscribe(employerRef: string, callback: (notice: SourceInvalidation) => void) {
    if (stopped) return null;
    validateEmployerRef(employerRef);
    const count = [...subscribers.values()].reduce((sum, listeners) => sum + listeners.size, 0);
    if (count >= MAX_SUBSCRIBERS) return null;
    const listeners = subscribers.get(employerRef) ?? new Set();
    listeners.add(callback);
    subscribers.set(employerRef, listeners);
    return () => {
      listeners.delete(callback);
      if (!listeners.size) {
        subscribers.delete(employerRef);
        // Do not retain queued notifications without any active browser.
        for (const key of pending.keys()) {
          if (key.startsWith(employerRef + sep)) pending.delete(key);
        }
      }
    };
  }

  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = undefined;
    pending.clear();
    subscribers.clear();
  }
  return {
    publish, subscribe, flush, stop,
    stats: () => ({
      pending: pending.size,
      subscribers: [...subscribers.values()].reduce((n, group) => n + group.size, 0),
      dropped,
    }),
  };
}
