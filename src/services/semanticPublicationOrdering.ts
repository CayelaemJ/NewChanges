// Do not allow an older source cursor to replace a newer semantic publication.
// Rollback is a separate, explicitly audited operation.
export function requireMonotonicSemanticWatermark(
  candidate: Date | null | undefined,
  previous: Date | null | undefined,
): void {
  if (!(candidate instanceof Date) || !Number.isFinite(candidate.getTime()))
    throw new Error("Semantic publication requires a valid source watermark");
  if (previous === undefined) return; // First publication: no previous pointer.
  if (!(previous instanceof Date) || !Number.isFinite(previous.getTime()))
    throw new Error("Previous semantic publication lacks a valid source watermark");
  if (candidate.getTime() < previous.getTime())
    throw new Error("Semantic publication cannot regress source watermark");
}
