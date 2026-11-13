/**
 * Safe handoff from a FUTURE MySQL binlog reader to the durable CDC outbox.
 *
 * The reader must deliver a fully committed binlog transaction and its
 * verified next position. This adapter neither opens a MySQL stream nor
 * claims to detect missing GTIDs/expired binlog files. Do not call with
 * speculative/uncommitted row events.
 */
import type { CdcLease } from "./sourceCdcCheckpoint.js";
import { commitCdcBatch } from "./sourceCdcCheckpoint.js";
import { classifySourceRowChange, type SourceRowChange } from "./sourceCdcClassifier.js";
import type { SourceChangeHint } from "./sourceInvalidationHub.js";

const MAX_SOURCE_ROWS = 256;
const MAX_HINTS = 512;

export interface CommittedSourceTransaction {
  committed: true;
  sourceId: string;
  /** The exact stored offset from which this reader resumed. */
  fromCursor: string;
  /** The first safe cursor AFTER this complete committed transaction. */
  toCursor: string;
  /** Complete before/after metadata for changed canonical source rows. */
  changes: readonly SourceRowChange[];
}

export interface CdcTransactionAccepted {
  nextCursor: string;
  sourceRows: number;
  invalidations: number;
}

function classifyCommittedTransaction(input: CommittedSourceTransaction): SourceChangeHint[] {
  if (input.committed !== true) throw new Error("Cannot checkpoint an uncommitted MySQL transaction");
  if (!Array.isArray(input.changes) || input.changes.length > MAX_SOURCE_ROWS)
    throw new Error("MySQL CDC transaction exceeds bounded row batch");
  // Large single source transactions MUST be explicitly chunked by a durable
  // upstream staging protocol; never advance to partial transaction offsets.
  const unique = new Map<string, SourceChangeHint>();
  for (const row of input.changes) {
    for (const hint of classifySourceRowChange(row)) {
      const key = JSON.stringify([hint.employerRef, hint.period, hint.feed]);
      unique.set(key, hint);
      if (unique.size > MAX_HINTS) throw new Error("CDC invalidations exceed safe transaction size");
    }
  }
  return [...unique.values()];
}

export async function ingestCommittedSourceTransaction(
  lease: CdcLease,
  input: CommittedSourceTransaction,
): Promise<CdcTransactionAccepted> {
  if (process.env.DIRECT_MYSQL_CDC_CONSUMER_ENABLED !== "true" ||
      process.env.DIRECT_MYSQL_REPORTING_ENABLED !== "true")
    throw new Error("MySQL CDC consumer is disabled");
  if (input.sourceId !== lease.sourceId || input.fromCursor !== lease.cursor)
    throw new Error("MySQL CDC source/cursor mismatch");
  if (!input.toCursor || input.fromCursor === input.toCursor)
    throw new Error("MySQL CDC transaction cursor did not advance");
  const hints = classifyCommittedTransaction(input);
  const written = await commitCdcBatch({
    lease, expectedCursor: input.fromCursor, nextCursor: input.toCursor, hints,
  });
  // The returned cursor may only be reused by a caller AFTER the durable
  // PostgreSQL transaction has successfully committed.
  return { nextCursor: input.toCursor, sourceRows: input.changes.length, invalidations: written };
}
