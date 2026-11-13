/**
 * A single fenced CDC capture session over an injected committed-transaction
 * stream. This module intentionally does NOT implement MySQL replication
 * protocol: the upstream reader still must validate GTID/file continuity,
 * transaction boundaries, ROW images and binlog retention.
 *
 * The session is sequential and fail-closed. No checkpoint is advanced on
 * aborted sessions, stale leases, failed Postgres commits or source errors.
 */
import {
  acquireCdcLease, renewCdcLease, type CdcLease,
} from "./sourceCdcCheckpoint.js";
import {
  ingestCommittedSourceTransaction, type CommittedSourceTransaction,
} from "./sourceCdcTransactionAdapter.js";

export interface CommittedTransactionReader {
  open(cursor: string, signal: AbortSignal): AsyncIterable<CommittedSourceTransaction>;
}
export interface CdcSessionOptions {
  sourceId: string;
  owner: string;
  reader: CommittedTransactionReader;
  signal?: AbortSignal;
  leaseMs?: number;
  maxTransactions?: number;
}
export interface CdcSessionOutcome {
  status: "LEASE_HELD" | "STOPPED" | "END_OF_STREAM";
  sourceId: string;
  lastCursor: string | null;
  committedTransactions: number;
  invalidationHints: number;
}

export async function runCdcCaptureSession(
  input: CdcSessionOptions,
): Promise<CdcSessionOutcome> {
  if (process.env.DIRECT_MYSQL_CDC_CONSUMER_ENABLED !== "true" ||
      process.env.DIRECT_MYSQL_REPORTING_ENABLED !== "true")
    throw new Error("CDC capture is disabled");
  if (!Number.isInteger(input.maxTransactions ?? 128) ||
      (input.maxTransactions ?? 128) < 1 ||
      (input.maxTransactions ?? 128) > 512)
    throw new Error("Invalid bounded CDC session length");
  if (input.signal?.aborted) throw new Error("CDC capture aborted before lease");
  const leaseMs = input.leaseMs ?? 30_000;
  const acquired = await acquireCdcLease(input.sourceId, input.owner, leaseMs);
  if (!acquired) return {
    status: "LEASE_HELD", sourceId: input.sourceId,
    lastCursor: null, committedTransactions: 0, invalidationHints: 0,
  };
  let lease: CdcLease = acquired;
  const controller = new AbortController();
  let lostLease = false;
  let renewable = false;
  const abort = () => controller.abort();
  input.signal?.addEventListener("abort", abort, { once: true });
  // A failed renewal makes this session unusable even if the source reader
  // keeps emitting; fenced PostgreSQL CAS still rejects a stolen lease.
  const heartbeatMs = Math.max(1_000, Math.floor(leaseMs / 3));
  const heartbeat = setInterval(async () => {
    if (renewable || controller.signal.aborted) return;
    renewable = true;
    try {
      const ok = await renewCdcLease(lease, leaseMs);
      if (!ok) { lostLease = true; controller.abort(); }
    } catch {
      lostLease = true;
      controller.abort();
    } finally {
      renewable = false;
    }
  }, heartbeatMs);
  heartbeat.unref?.();
  let committedTransactions = 0;
  let invalidationHints = 0;
  let endOfStream = false;
  try {
    const stream = input.reader.open(acquired.cursor, controller.signal);
    // The reader must honor abort and close network sockets. This session
    // only persists fully committed transactions in source cursor order.
    for await (const transaction of stream) {
      if (lostLease) throw new Error("CDC source lease lost");
      if (controller.signal.aborted) break;
      if (transaction.fromCursor !== lease.cursor)
        throw new Error("CDC source continuity gap: refusing checkpoint");
      const accepted = await ingestCommittedSourceTransaction(lease, transaction);
      lease = { ...lease, cursor: accepted.nextCursor };
      committedTransactions++;
      invalidationHints += accepted.invalidations;
      if (committedTransactions >= (input.maxTransactions ?? 128)) break;
    }
    endOfStream = !controller.signal.aborted;
    if (lostLease) throw new Error("CDC source lease lost");
    return {
      status: endOfStream ? "END_OF_STREAM" : "STOPPED",
      sourceId: input.sourceId, lastCursor: lease.cursor,
      committedTransactions, invalidationHints,
    };
  } finally {
    clearInterval(heartbeat);
    input.signal?.removeEventListener("abort", abort);
    controller.abort();
    // Lease expiration is the recovery fence; do not mutate another
    // worker's lease here without a guarded generation comparison.
  }
}
