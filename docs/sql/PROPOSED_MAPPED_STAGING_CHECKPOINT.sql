-- PROPOSAL ONLY: DO NOT RUN AGAINST PRODUCTION OR ADD TO AUTO-MIGRATIONS.
-- Lightweight fenced cursor ledger. One row per candidate generation/feed.
-- Review PII retention and schema placement before a separately approved rollout.
CREATE TABLE IF NOT EXISTS "MappedStagingCheckpoint" (
  "generation" text NOT NULL,
  "feed" text NOT NULL,
  "owner" text NOT NULL,
  "fence" bigint NOT NULL DEFAULT 1,
  "version" bigint NOT NULL DEFAULT 0,
  "leaseExpiresAt" timestamptz NOT NULL,
  "snapshotId" text,
  "cursor" jsonb,
  "objectKey" text,
  "sha256" char(64),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "MappedStagingCheckpoint_pkey" PRIMARY KEY ("generation","feed"),
  CONSTRAINT "MappedStagingCheckpoint_fence_check" CHECK ("fence" >= 1 AND "version" >= 0)
);
-- Do not index the JSON cursor: the small primary-key lookup is sufficient.
-- Production approval must first verify a snapshot/resume strategy; a new
-- MySQL transaction snapshot is NOT the same immutable source snapshot.
