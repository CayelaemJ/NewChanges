/**
 * Durable CDC outbox -> employer version projection, NOT source data replication.
 * The outbox delivery marker and version bump commit atomically.
 *
 * Two concurrent dispatchers may read the same rows, but only one may mark
 * them delivered: the losing transaction must roll back its version bumps.
 * A missed process-local SSE message is recovered by reading this version.
 */
import { prisma } from "./database.js";

const SOURCE_MAX = 128;
function sourceIdOrThrow(sourceId: string) {
  if (typeof sourceId !== "string" || !sourceId.trim() ||
      sourceId.length > SOURCE_MAX || sourceId.includes("\u0000"))
    throw new Error("Invalid CDC source ID");
}

export interface CdcDurableVersion {
  employerRef: string;
  version: string;
}

export async function dispatchCdcOutboxToVersions(
  sourceId: string,
  batchSize = 100,
): Promise<{ delivered: number; versions: CdcDurableVersion[] }> {
  sourceIdOrThrow(sourceId);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100)
    throw new Error("Invalid CDC dispatch batch size");
  return prisma.$transaction(async tx => {
    const pending = await tx.sourceCdcOutbox.findMany({
      where: { sourceId, deliveredAt: null },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: batchSize,
      select: { id: true, employerRef: true },
    });
    if (!pending.length) return { delivered: 0, versions: [] };
    const ids = pending.map(item => item.id);
    // First claim all rows in this transaction. Row locks are retained
    // until commit; a competing dispatcher either claims zero or retries.
    const claimed = await tx.sourceCdcOutbox.updateMany({
      where: { sourceId, id: { in: ids }, deliveredAt: null },
      data: { deliveredAt: new Date() },
    });
    if (claimed.count !== ids.length)
      throw new Error("CDC outbox contention: retry without advancing versions");
    const employers = [...new Set(pending.map(item => item.employerRef))];
    const versions: CdcDurableVersion[] = [];
    for (const employerRef of employers) {
      const version = await tx.sourceCdcVersion.upsert({
        where: { sourceId_employerRef: { sourceId, employerRef } },
        create: { sourceId, employerRef, version: 1n },
        update: { version: { increment: 1n } },
        select: { employerRef: true, version: true },
      });
      versions.push({ employerRef: version.employerRef, version: String(version.version) });
    }
    return { delivered: pending.length, versions };
  });
}

/**
 * Tenant authorization belongs in the HTTP handler, before this call.
 * Read only a tiny control-plane version, never reporting facts.
 */
export async function readCdcEmployerVersion(sourceId: string, employerRef: string): Promise<string> {
  sourceIdOrThrow(sourceId);
  if (typeof employerRef !== "string" || !employerRef.trim() ||
      employerRef.length > 128 || employerRef.includes("\u0000"))
    throw new Error("Invalid CDC employer reference");
  const row = await prisma.sourceCdcVersion.findUnique({
    where: { sourceId_employerRef: { sourceId, employerRef } },
    select: { version: true },
  });
  return String(row?.version ?? 0n);
}
