/**
 * Default-off, PROCESS-LOCAL CDC feed-publication prototype.
 *
 * Keep MySQL canonical reporting data in MySQL: the coordinator holds only
 * a bounded number of employer-scoped row counts and successful generations.
 * It neither persists rows in PostgreSQL nor sends dashboard/SSE events.
 *
 * Production still needs an independently authorized source-tenant mapping,
 * approved RDS reader, durable generation store, aggregation parity and
 * an atomic, multi-process cache publication mechanism.
 */
import {
  type CdcMysqlFeedRead,
  type CdcMysqlReaderSettings,
  type VerifiedEmployerScope,
} from "./ingestStageCdcMysqlReader.js";
import { LOAD_ORDER } from "./reportFormats.js";

const ALLOWED = new Set(LOAD_ORDER);

export type CdcFeedReader = (
  feed: string,
  employerRef: string,
  scope: VerifiedEmployerScope,
  settings: CdcMysqlReaderSettings,
) => Promise<CdcMysqlFeedRead>;

export interface CdcFeedSummary {
  readonly feed: string;
  readonly employerRef: string;
  readonly generation: number;
  readonly rowCount: number;
  readonly publishedAtMs: number;
}

export interface CdcFeedSummaryPublisherOptions {
  read: CdcFeedReader;
  ttlMs?: number;
  maxCacheEntries?: number;
  now?: () => number;
}

/** Only a short-lived metadata preview, not the existing dashboard payload. */
export function createCdcFeedSummaryPublisher(options: CdcFeedSummaryPublisherOptions) {
  const ttlMs = options.ttlMs ?? 30_000;
  const maxCacheEntries = options.maxCacheEntries ?? 128;
  const now = options.now ?? Date.now;
  if (typeof options.read !== "function" || typeof now !== "function" ||
      !Number.isSafeInteger(ttlMs) || ttlMs < 1000 || ttlMs > 300_000 ||
      !Number.isSafeInteger(maxCacheEntries) ||
      maxCacheEntries < 1 || maxCacheEntries > 1024) {
    throw new Error("CDC_PUBLICATION_CONFIG_INVALID");
  }

  const cache = new Map<string, CdcFeedSummary>();
  const pending = new Map<string, Promise<CdcFeedSummary>>();

  function scopeKey(feed: string, employerRef: string, scope: VerifiedEmployerScope): string {
    if (!ALLOWED.has(feed) ||
        typeof employerRef !== "string" || !employerRef ||
        employerRef.length > 200 || employerRef.trim() !== employerRef ||
        !Array.isArray(scope?.authorizedEmployerRefs) ||
        !scope.authorizedEmployerRefs.includes(employerRef) ||
        scope.authorizedEmployerRefs.length > 128 ||
        !scope.authorizedEmployerRefs.every(value =>
          typeof value === "string" && value.length > 0 &&
          value.length <= 200 && value.trim() === value))
      throw new Error("CDC_PUBLICATION_SCOPE_DENIED");
    return JSON.stringify([feed, employerRef]);
  }

  function clock(): number {
    const ms = now();
    if (!Number.isSafeInteger(ms) || ms < 0)
      throw new Error("CDC_PUBLICATION_CLOCK_INVALID");
    return ms;
  }

  function generation(value: number): number {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error("CDC_PUBLICATION_GENERATION_INVALID");
    return value;
  }

  function fresh(value: CdcFeedSummary, current: number): boolean {
    return value.publishedAtMs <= current && current - value.publishedAtMs < ttlMs;
  }

  function get(
    feed: string, employerRef: string, scope: VerifiedEmployerScope,
  ): CdcFeedSummary | null {
    const key = scopeKey(feed, employerRef, scope);
    const value = cache.get(key);
    return value && fresh(value, clock()) ? value : null;
  }

  async function publish(input: {
    feed: string;
    employerRef: string;
    scope: VerifiedEmployerScope;
    generation: number;
    settings: CdcMysqlReaderSettings;
  }): Promise<CdcFeedSummary> {
    const { feed, employerRef, scope, settings } = input;
    const key = scopeKey(feed, employerRef, scope);
    const requested = generation(input.generation);
    // A cached summary is not authorization to query MySQL or advance CDC.
    // These declarations must reflect independent verification by the caller.
    if (settings.featureEnabled !== true ||
        settings.accessReviewed !== true ||
        settings.snapshotVerified !== true)
      throw new Error("CDC_PUBLICATION_SOURCE_NOT_APPROVED");
    if (!Number.isSafeInteger(settings.maxRows) ||
        settings.maxRows < 1 || settings.maxRows > 2000)
      throw new Error("CDC_PUBLICATION_SOURCE_BUDGET_INVALID");

    // One in-flight query per feed and employer. A newer notification arriving
    // during that read is retried after the older publication finishes.
    while (true) {
      const existing = cache.get(key);
      if (existing && existing.generation > requested)
        throw new Error("CDC_PUBLICATION_GENERATION_REGRESSION");
      if (existing && existing.generation === requested && fresh(existing, clock()))
        return existing;
      const running = pending.get(key);
      if (!running) break;
      await running;
    }

    // Pending keys reserve capacity, preventing concurrent first publications
    // from exceeding the bound before either response has been committed.
    const pendingNewKeys = [...pending.keys()].filter(k => !cache.has(k)).length;
    if (!cache.has(key) && cache.size + pendingNewKeys >= maxCacheEntries)
      throw new Error("CDC_PUBLICATION_CAPACITY_EXCEEDED");

    const operation = (async (): Promise<CdcFeedSummary> => {
      let completed: CdcMysqlFeedRead;
      try {
        completed = await options.read(feed, employerRef, scope, settings);
      } catch {
        // Driver exceptions can contain a hostname, a query or a value.
        throw new Error("CDC_PUBLICATION_SOURCE_READ_FAILED");
      }
      if (completed.complete !== true ||
          completed.source !== "MYSQL_READ_ONLY" ||
          completed.feed !== feed ||
          completed.employerRef !== employerRef ||
          !Array.isArray(completed.records) ||
          completed.records.length > settings.maxRows ||
          completed.records.some(row =>
            !row || typeof row !== "object" ||
            row.employer_ref !== employerRef))
        throw new Error("CDC_PUBLICATION_INCOMPLETE_MYSQL_READ");

      // The only data retained is a count and a generation. Source rows are
      // never stored in this cache, in PostgreSQL or in an SSE message.
      const summary: CdcFeedSummary = Object.freeze({
        feed, employerRef, generation: requested,
        rowCount: completed.records.length,
        publishedAtMs: clock(),
      });
      cache.set(key, summary);
      return summary;
    })();
    pending.set(key, operation);
    try {
      return await operation;
    } finally {
      if (pending.get(key) === operation) pending.delete(key);
    }
  }

  return { get, publish };
}
