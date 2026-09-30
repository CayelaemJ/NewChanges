-- Enterprise analytics placement controls
ALTER TABLE "IntegrationConfig"
  ADD COLUMN IF NOT EXISTS "analyticsMode" TEXT NOT NULL DEFAULT 'POSTGRES_READ_MODEL',
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsReadOnly" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsUseReplica" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsNote" TEXT;

CREATE TABLE IF NOT EXISTS "AnalyticsRoute" (
  "id" TEXT NOT NULL,
  "reportKey" TEXT NOT NULL,
  "executionMode" TEXT NOT NULL DEFAULT 'POSTGRES',
  "sourceView" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "rationale" TEXT,
  "lastVerifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AnalyticsRoute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AnalyticsRoute_reportKey_key" ON "AnalyticsRoute"("reportKey");
CREATE INDEX IF NOT EXISTS "AnalyticsRoute_executionMode_enabled_idx" ON "AnalyticsRoute"("executionMode","enabled");
