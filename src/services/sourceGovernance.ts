// Governs source generations and semantic publication metadata.
// Never copies source credentials into model metadata or stores raw dashboard payloads.
import { createHash } from "node:crypto";
import { prisma } from "./snapshotBuilder.js";
import { LOAD_ORDER } from "./reportFormats.js";
import { effectiveSourceConfig, configuredSourceMode } from "./sourceAdapter.js";
import type { IntegrationConfigPatch } from "./syncService.js";
import { getConfig, previewSourceSwitch } from "./syncService.js";
import { pickSourceSettings, sealSourceSettings } from "./sourceConnectionVault.js";

function identity(input: any) {
  const c = effectiveSourceConfig(input);
  return {
    mode: configuredSourceMode(c),
    dialect: c.sqlDialect ?? null,
    host: c.sqlHost?.toLowerCase() ?? null,
    port: c.sqlPort ?? null,
    database: c.sqlDatabase ?? null,
    schema: c.sqlSchema ?? null,
    prefix: c.sqlViewPrefix ?? null,
    apiBaseUrl: c.baseUrl ?? null,
  };
}

export function sourceFingerprint(config: any) {
  return createHash("sha256").update(JSON.stringify(identity(config))).digest("hex");
}

export async function stageValidatedGeneration(patch: IntegrationConfigPatch) {
  const preflight = await previewSourceSwitch(patch);
  if (!preflight.ok) return preflight;
  const saved = await getConfig();
  const safePatch = { ...patch };
  if (!safePatch.authToken) delete safePatch.authToken;
  if (!safePatch.sqlPassword) delete safePatch.sqlPassword;
  const candidate = { ...saved, ...safePatch };
  const fp = sourceFingerprint(candidate);
  const id = identity(candidate);
  const endpointLabel = id.mode === "SQL"
    ? `${id.dialect}:${id.host ?? "unknown"}/${id.database ?? "unknown"}`
    : "API source"; // Keep sensitive API URLs outside the registry.
  const now = new Date();
  const validation = { feedCount: preflight.testedFeeds, checkedAt: now.toISOString(), watermarks: preflight.watermarks ?? [], sourceChanged: preflight.sourceChanged };
  const generation = await prisma.sourceGeneration.upsert({
    where: { fingerprint: fp },
    create: { fingerprint: fp, sourceMode: id.mode, endpointLabel, state: "VALIDATED", validatedAt: now, validation },
    // Never demote ACTIVE generations on repeated preflight.
    update: { validation, validatedAt: now },
  });
  // All feed checkpoints start null for a different source. Never reuse
  // the legacy cursor because the view names happen to match.
  for (const reportKey of LOAD_ORDER) {
    await prisma.sourceGenerationCursor.upsert({
      where: { generationId_reportKey: { generationId: generation.id, reportKey } },
      create: { generationId: generation.id, reportKey },
      update: {},
    });
  }
  // The candidate's complete source settings are encrypted at rest, and
  // never returned through an Admin API. Revalidating ACTIVE sources must not
  // silently overwrite the rollback credential record.
  let credentialsStaged = false;
  if (generation.state !== "ACTIVE" && process.env.SOURCE_CONNECTION_VAULT_KEY) {
    const sealed = sealSourceSettings(generation.id, pickSourceSettings(candidate));
    await prisma.sourceConnectionVault.upsert({
      where: { generationId: generation.id },
      create: { generationId: generation.id, ...sealed },
      update: sealed,
    });
    credentialsStaged = true;
  }
  return { ...preflight, generationId: generation.id, state: "VALIDATED", activationAvailable: false, credentialsStaged,
    note: "Candidate generation validated and registered. Activation remains blocked until dataset continuity and staged semantic snapshots are verified." };
}

export async function listSourceGenerations() {
  return prisma.sourceGeneration.findMany({
    select: { id: true, sourceMode: true, endpointLabel: true, state: true, validatedAt: true, activatedAt: true, updatedAt: true,
      cursors: { select: { reportKey: true, lastSourceUpdatedAt: true, reconciledAt: true } } },
    orderBy: { updatedAt: "desc" }, take: 50,
  });
}

export async function getSemanticPublicationStatus() {
  const published = await prisma.semanticSnapshotManifest.findMany({
    where: { state: "PUBLISHED" },
    select: { generationId: true, employerId: true, period: true, version: true, sourceWatermark: true, publishedAt: true, bytes: true },
    orderBy: { publishedAt: "desc" }, take: 50,
  });
  return { published, storageStatus: "MANIFEST_ONLY", servingEnabled: false,
    note: "External object storage and atomic semantic-publish worker are not connected yet; existing dashboard delivery remains unchanged." };
}
