-- NewChanges MLOps governance layer
-- Reconciliation is additive so an existing non-empty telemetry table is never dropped.
ALTER TABLE IF EXISTS "MLOpsEvent"
  ADD COLUMN IF NOT EXISTS "eventType" TEXT DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS "modelKey" TEXT DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS "modelVersion" TEXT DEFAULT 'legacy',
  ADD COLUMN IF NOT EXISTS "employerId" TEXT,
  ADD COLUMN IF NOT EXISTS "period" TEXT,
  ADD COLUMN IF NOT EXISTS "metric" TEXT,
  ADD COLUMN IF NOT EXISTS "actualValue" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "predictedValue" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "confidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "driftScore" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "anomalyScore" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "status" TEXT,
  ADD COLUMN IF NOT EXISTS "feedback" TEXT,
  ADD COLUMN IF NOT EXISTS "features" JSONB,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB,
  ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;
UPDATE "MLOpsEvent" SET "eventType"='UNKNOWN' WHERE "eventType" IS NULL;
UPDATE "MLOpsEvent" SET "modelKey"='unknown' WHERE "modelKey" IS NULL;
UPDATE "MLOpsEvent" SET "modelVersion"='legacy' WHERE "modelVersion" IS NULL;
UPDATE "MLOpsEvent" SET "createdAt"=CURRENT_TIMESTAMP WHERE "createdAt" IS NULL;
ALTER TABLE "MLOpsEvent"
  ALTER COLUMN "eventType" SET NOT NULL,
  ALTER COLUMN "modelKey" SET NOT NULL,
  ALTER COLUMN "modelVersion" SET NOT NULL,
  ALTER COLUMN "createdAt" SET NOT NULL;

CREATE TABLE IF NOT EXISTS "MLOpsEvent" (
  "id" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "modelKey" TEXT NOT NULL,
  "modelVersion" TEXT NOT NULL,
  "employerId" TEXT,
  "period" TEXT,
  "metric" TEXT,
  "actualValue" DOUBLE PRECISION,
  "predictedValue" DOUBLE PRECISION,
  "confidence" DOUBLE PRECISION,
  "driftScore" DOUBLE PRECISION,
  "anomalyScore" DOUBLE PRECISION,
  "status" TEXT,
  "feedback" TEXT,
  "features" JSONB,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MLOpsEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "MLOpsEvent_modelKey_createdAt_idx" ON "MLOpsEvent"("modelKey","createdAt");
CREATE INDEX IF NOT EXISTS "MLOpsEvent_employerId_period_idx" ON "MLOpsEvent"("employerId","period");
CREATE INDEX IF NOT EXISTS "MLOpsEvent_eventType_createdAt_idx" ON "MLOpsEvent"("eventType","createdAt");

CREATE TABLE IF NOT EXISTS "MLOpsModel" (
  "id" TEXT NOT NULL,
  "modelKey" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "modelType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'SHADOW',
  "trainingVersion" TEXT,
  "metrics" JSONB,
  "featureSchema" JSONB,
  "promotedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MLOpsModel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MLOpsModel_modelKey_version_key" UNIQUE ("modelKey","version")
);
CREATE INDEX IF NOT EXISTS "MLOpsModel_modelKey_status_idx" ON "MLOpsModel"("modelKey","status");

-- Brand-learning state and partner diagnostics are additive. Existing brand configuration is preserved.
CREATE TABLE IF NOT EXISTS "BrandLearningState" (
  "id" TEXT NOT NULL DEFAULT 'global',
  "engineVersion" TEXT NOT NULL,
  "uploadCount" INTEGER NOT NULL DEFAULT 0,
  "labelledCount" INTEGER NOT NULL DEFAULT 0,
  "acceptedCount" INTEGER NOT NULL DEFAULT 0,
  "averageConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "huePrior" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BrandLearningState_pkey" PRIMARY KEY ("id")
);

ALTER TABLE IF EXISTS "Partner"
  ADD COLUMN IF NOT EXISTS "brandEngineVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "brandDetectionStatus" TEXT DEFAULT 'UNREVIEWED',
  ADD COLUMN IF NOT EXISTS "brandDetectionConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "brandDetectionWarnings" JSONB,
  ADD COLUMN IF NOT EXISTS "brandDetectionDiagnostics" JSONB,
  ADD COLUMN IF NOT EXISTS "brandDetectedPalette" JSONB,
  ADD COLUMN IF NOT EXISTS "brandDetectedAt" TIMESTAMP(3);
