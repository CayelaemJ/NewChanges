// Deterministic publication gates are mandatory before ML-derived judgements.
// No model prediction can override failed lineage, data freshness, or integrity checks.
import { prisma } from "./snapshotBuilder.js";
import { LOAD_ORDER } from "./reportFormats.js";

export type PublicationGate = { key: string; passed: boolean; reason: string };
export function evaluatePublicationGates(input: {
  sourceValidated: boolean; reconciledFeeds: string[];
  storageVerified: boolean; sha256Verified: boolean;
  partitionNonempty: boolean; watermark?: Date | null;
  maxFreshnessAgeMs?: number; now?: Date;
}): { ready: boolean; gates: PublicationGate[] } {
  const now = input.now ?? new Date();
  const lag = input.watermark ? now.getTime() - new Date(input.watermark).getTime() : Infinity;
  const maxAge = input.maxFreshnessAgeMs ?? 15 * 60_000;
  const missingFeeds = LOAD_ORDER.filter(key => !input.reconciledFeeds.includes(key));
  const gates: PublicationGate[] = [
    { key: "source_validation", passed: input.sourceValidated, reason: input.sourceValidated ? "Source validated" : "Source not validated" },
    { key: "feed_reconciliation", passed: missingFeeds.length === 0, reason: missingFeeds.length ? `Missing reconciled feeds: ${missingFeeds.join(", ")}` : "All ten feeds reconciled" },
    { key: "storage_integrity", passed: input.storageVerified && input.sha256Verified, reason: "Object exists and its content digest matches the manifest" },
    { key: "nonempty_partition", passed: input.partitionNonempty, reason: "Partition must contain validated results" },
    { key: "freshness", passed: Number.isFinite(lag) && lag >= 0 && lag <= maxAge, reason: "Source watermark must be recent and not in the future" },
  ];
  return { ready: gates.every(g => g.passed), gates };
}

// Read-only readiness report. Manifest metadata alone is deliberately not
// proof that bytes exist in a durable external object store.
export async function semanticPublicationReadiness(manifestId: string) {
  const manifest = await prisma.semanticSnapshotManifest.findUnique({ where: { id: manifestId } });
  if (!manifest) return { ready: false, error: "Unknown semantic manifest" };
  const generation = await prisma.sourceGeneration.findUnique({
    where: { id: manifest.generationId },
    include: { cursors: { select: { reportKey: true, reconciledAt: true } } },
  });
  const report = evaluatePublicationGates({
    sourceValidated: Boolean(generation?.validatedAt && ["VALIDATED", "ACTIVE"].includes(generation.state)),
    reconciledFeeds: (generation?.cursors ?? []).filter(c => c.reconciledAt).map(c => c.reportKey),
    // Until the object-store verifier exists, fail closed rather than accepting
    // caller-provided booleans as evidence of persistence or integrity.
    storageVerified: false, sha256Verified: false,
    partitionNonempty: manifest.bytes > 0 && Boolean(manifest.contentSha256),
    watermark: manifest.sourceWatermark,
  });
  return { manifestId, generationId: manifest.generationId, ...report, servingEnabled: false };
}
