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

function validateTenant(record: SourceRowMetadata | null | undefined): string {
  const employerRef = record?.employer_ref;
  if (typeof employerRef !== "string" || !employerRef.trim() || employerRef.length > 128)
    throw new Error("CDC change missing valid employer_ref");
  return employerRef;
}

/**
 * Prefer correctness over false precision:
 * - UPDATE / DELETE: an arbitrary earlier snapshot or metric may change.
 * - dimension/stock INSERT: may affect historical cohorts and score weights.
 * - flow INSERT: conservatively invalidate all periods including later cumulative views.
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

  // All canonical feeds influence cumulative historical and current metrics.
  // Until a dependency DAG proves period-limited updates are correct, a
  // single employer-wide hint prevents later-month figures from going stale.
  return [...employerRefs].map(employerRef => ({
    feed: change.feed, employerRef, period: null,
  }));
}
