-- NewChanges MLOps governance layer
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
