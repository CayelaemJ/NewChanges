/**
 * Transactional CDC checkpoint + durable invalidation outbox.
 *
 * This holds ONLY source positions, lease state and small tenant/feed/period
 * hints in the application database. It does not replicate MySQL business rows.
 * No binlog stream is started here: integration remains feature-gated.
 *
 * A position can advance only inside the SAME PostgreSQL transaction as its
 * invalidation hints. Fenced leases and expected-cursor CAS prevent a stale
 * reader from committing after another reader takes over.
 */
import { createHash } from "node:crypto";
import { prisma } from "./database.js";
import type { SourceChangeHint } from "./sourceInvalidationHub.js";
import { LOAD_ORDER } from "./reportFormats.js";

const MAX_BATCH = 512;
const MAX_CURSOR = 512;
const MAX_OWNER = 128;
const MAX_SOURCE = 128;
const LEASE_MS_MIN = 5_000;
const LEASE_MS_MAX = 60_000;

export interface CdcLease {
  sourceId: string;
  owner: string;
  generation: number;
  expiresAt: Date;
  cursor: string;
}

export interface CdcCommitInput {
  lease: Pick<CdcLease, "sourceId" | "owner" | "generation">;
  expectedCursor: string;
  nextCursor: string;
  hints: readonly SourceChangeHint[];
}

function bounded(value: unknown, description: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max ||
      value.includes("\u0000")) throw new Error(`Invalid CDC ${description}`);
  return value;
}
function cursor(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_CURSOR || value.includes("\u0000"))
    throw new Error("Invalid CDC cursor");
  return value;
}
function validPeriod(value: string | null): boolean {
  return value === null || /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
function checkedHints(hints: readonly SourceChangeHint[]): SourceChangeHint[] {
  if (!Array.isArray(hints) || hints.length > MAX_BATCH)
    throw new Error("CDC batch exceeds bounded outbox size");
  return hints.map(hint => {
    if (!LOAD_ORDER.includes(hint.feed) ||
        !validPeriod(hint.period) ||
        typeof hint.employerRef !== "string" ||
        !hint.employerRef.trim() || hint.employerRef.length > 128 ||
        hint.employerRef.includes("\u0000"))
      throw new Error("Invalid CDC invalidation hint");
    return {
      feed: hint.feed, employerRef: hint.employerRef, period: hint.period,
    };
  });
}

export async function acquireCdcLease(
  sourceId: string,
  owner: string,
  leaseMs = 15_000,
): Promise<CdcLease | null> {
  bounded(sourceId, "source ID", MAX_SOURCE);
  bounded(owner, "lease owner", MAX_OWNER);
  if (!Number.isInteger(leaseMs) || leaseMs < LEASE_MS_MIN || leaseMs > LEASE_MS_MAX)
    throw new Error("Invalid CDC lease duration");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + leaseMs);
  return prisma.$transaction(async tx => {
    // Atomic create-if-absent; a concurrent winner is handled by the
    // conditional update below, not by relying on an unguarded SELECT.
    await tx.sourceCdcCheckpoint.createMany({
      data: [{ id: sourceId, cursor: "" }], skipDuplicates: true,
    });
    const updated = await tx.sourceCdcCheckpoint.updateMany({
      where: {
        id: sourceId,
        OR: [
          { leaseOwner: null },
          { leaseExpiresAt: null },
          { leaseExpiresAt: { lte: now } },
          { leaseOwner: owner },
        ],
      },
      data: {
        leaseOwner: owner,
        leaseExpiresAt: expiresAt,
        leaseGeneration: { increment: 1 },
      },
    });
    if (updated.count !== 1) return null;
    const row = await tx.sourceCdcCheckpoint.findUniqueOrThrow({ where: { id: sourceId } });
    return {
      sourceId, owner, generation: row.leaseGeneration,
      expiresAt: row.leaseExpiresAt!, cursor: row.cursor,
    };
  });
}

export async function renewCdcLease(lease: CdcLease, leaseMs = 15_000): Promise<boolean> {
  bounded(lease.sourceId, "source ID", MAX_SOURCE);
  bounded(lease.owner, "lease owner", MAX_OWNER);
  if (!Number.isInteger(lease.generation) || lease.generation < 1 ||
      !Number.isInteger(leaseMs) || leaseMs < LEASE_MS_MIN || leaseMs > LEASE_MS_MAX)
    throw new Error("Invalid CDC renewal");
  const now = new Date();
  const updated = await prisma.sourceCdcCheckpoint.updateMany({
    where: {
      id: lease.sourceId,
      leaseOwner: lease.owner, leaseGeneration: lease.generation,
      leaseExpiresAt: { gt: now },
    },
    data: { leaseExpiresAt: new Date(now.getTime() + leaseMs) },
  });
  return updated.count === 1;
}

export async function commitCdcBatch(input: CdcCommitInput): Promise<number> {
  const sourceId = bounded(input.lease.sourceId, "source ID", MAX_SOURCE);
  const owner = bounded(input.lease.owner, "lease owner", MAX_OWNER);
  const expected = cursor(input.expectedCursor);
  const next = bounded(input.nextCursor, "next cursor", MAX_CURSOR);
  if (expected === next) throw new Error("CDC checkpoint must advance");
  if (!Number.isInteger(input.lease.generation) || input.lease.generation < 1)
    throw new Error("Invalid CDC lease generation");
  const hints = checkedHints(input.hints);
  const now = new Date();
  return prisma.$transaction(async tx => {
    // Cursor CAS plus generation and unexpired lease, all in the same TX
    // that inserts the outbox rows. On any failure the position must not move.
    const result = await tx.sourceCdcCheckpoint.updateMany({
      where: {
        id: sourceId,
        cursor: expected,
        leaseOwner: owner,
        leaseGeneration: input.lease.generation,
        leaseExpiresAt: { gt: now },
      },
      data: { cursor: next },
    });
    if (result.count !== 1) throw new Error("CDC checkpoint rejected: stale lease or cursor");
    if (hints.length) {
      const rows = hints.map(hint => ({
        id: createHash("sha256").update(JSON.stringify([
          sourceId, next, hint.employerRef, hint.period ?? "", hint.feed,
        ])).digest("hex"),
        sourceId, sourceCursor: next,
        employerRef: hint.employerRef,
        period: hint.period ?? "", feed: hint.feed,
      }));
      await tx.sourceCdcOutbox.createMany({ data: rows, skipDuplicates: true });
    }
    return hints.length;
  });
}

/** Return only minimal metadata; never source business records. */
export async function pendingCdcInvalidations(sourceId: string, limit = 100) {
  bounded(sourceId, "source ID", MAX_SOURCE);
  if (!Number.isInteger(limit) || limit < 1 || limit > 200)
    throw new Error("Invalid CDC outbox page size");
  return prisma.sourceCdcOutbox.findMany({
    where: { sourceId, deliveredAt: null },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: limit,
    select: { id: true, employerRef: true, period: true, feed: true, sourceCursor: true },
  });
}

/**
 * Acknowledge ONLY after a durable downstream invalidation/version exists.
 * Publishing to an in-memory SSE hub ALONE is insufficient for this call.
 */
export async function acknowledgeDurableCdcInvalidations(sourceId: string, ids: string[]): Promise<number> {
  bounded(sourceId, "source ID", MAX_SOURCE);
  if (!Array.isArray(ids) || !ids.length || ids.length > 200 ||
      ids.some(id => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)))
    throw new Error("Invalid CDC outbox acknowledgement");
  const result = await prisma.sourceCdcOutbox.updateMany({
    where: { sourceId, id: { in: ids }, deliveredAt: null },
    data: { deliveredAt: new Date() },
  });
  return result.count;
}
