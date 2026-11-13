/**
 * Classify minimal canonical MySQL row-change metadata into conservative
 * employer/period invalidations. No MySQL driver and no financial row payloads.
 *
 * Source connectors must supply BEFORE and AFTER metadata from FULL-row-image
 * changes where relevant. A missing prior image for UPDATE/DELETE is unsafe:
 * fail rather than silently keep old tenant snapshots.
 */
import { LOAD_ORDER } from "./reportFormats.js";
import type { CanonicalFeed, SourceChangeHint } from "./sourceInvalidationHub.js";

export type SourceRowOperation = "INSERT" | "UPDATE" | "DELETE";
export interface SourceRowMetadata {
  employer_ref: string;
  started_at?: string | null;
  completed_at?: string | null;
  created_at?: string | null;
  shared_at?: string | null;
  advanced_at?: string | null;
}
export interface SourceRowChange {
  feed: CanonicalFeed;
  operation: SourceRowOperation;
  before?: SourceRowMetadata | null;
  after?: SourceRowMetadata | null;
}

const EVENTS: Record<string, string[]> = {
  journeys: ["started_at", "completed_at"],
  ratings: ["created_at"],
  referrals: ["shared_at"],
  salary_advances: ["advanced_at"],
};

function validateTenant(record: SourceRowMetadata | null | undefined): string {
  const employerRef = record?.employer_ref;
  if (typeof employerRef !== "string" || !employerRef.trim() || employerRef.length > 128)
    throw new Error("CDC change missing valid employer_ref");
  return employerRef;
}

function monthOf(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  // MySQL reporting views use calendar dates. Explicitly reject ambiguous
  // non-ISO input rather than assign the wrong month to a timestamp.
  const match = /^(\d{4})-(0[1-9]|1[0-2])-(\d{2})(?:$|[T ])/.exec(raw);
  if (!match) return null;
  const date = new Date(match[0].slice(0, 10) + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === match[0].slice(0, 10)
    ? raw.slice(0, 7) : null;
}

/**
 * Prefer correctness over false precision:
 * - UPDATE / DELETE: an arbitrary earlier snapshot or metric may change.
 * - dimension/stock INSERT: may affect historical cohorts and score weights.
 * - flow INSERT: use specific event month(s) when dates are reliable.
 * - employer reassignment UPDATE: invalidate BOTH original and new tenant.
 */
export function classifySourceRowChange(change: SourceRowChange): SourceChangeHint[] {
  if (!LOAD_ORDER.includes(change.feed)) throw new Error("Unsupported canonical feed");
  if (!["INSERT", "UPDATE", "DELETE"].includes(change.operation))
    throw new Error("Unknown MySQL change operation");

  const current = change.operation !== "DELETE" ? change.after : null;
  const previous = change.operation !== "INSERT" ? change.before : null;
  if (change.operation !== "DELETE" && !current) throw new Error("CDC after-image is required");
  if (change.operation !== "INSERT" && !previous) throw new Error("CDC before-image is required");

  const employerRefs = new Set<string>();
  if (previous) employerRefs.add(validateTenant(previous));
  if (current) employerRefs.add(validateTenant(current));

  const hints: SourceChangeHint[] = [];
  for (const employerRef of employerRefs) {
    const periods = new Set<string | null>();
    // Cumulative reporting (completed journeys, satisfaction, take-up,
    // historical comparisons) means a new event can alter later periods too.
    // Until downstream dependency-aware invalidation is proven, invalidate
    // the employer's full date range even for an ordinary INSERT.
    if (change.operation !== "INSERT" || !(change.feed in EVENTS)) {
      periods.add(null);
    } else {
      const dates = EVENTS[change.feed];
      for (const dateField of dates) {
        const period = monthOf(current?.[dateField as keyof SourceRowMetadata]);
        if (period) periods.add(period);
      }
      // Event-month hints alone are not sufficient for cumulative metrics.
      // One broad hint is cheap and safe; key-level version projection still
      // updates only this employer, not other employers or business rows.
      periods.clear();
      periods.add(null);
    }
    for (const period of periods) hints.push({ feed: change.feed, employerRef, period });
  }
  return hints;
}
