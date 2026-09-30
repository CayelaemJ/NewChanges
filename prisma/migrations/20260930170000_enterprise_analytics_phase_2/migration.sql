-- Enterprise analytics phase 2: optional read-only source replica routing
ALTER TABLE "IntegrationConfig"
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsReplicaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsReplicaHost" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsReplicaPort" INTEGER,
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsReplicaDatabase" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsReplicaSchema" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsReplicaUsername" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsReplicaPassword" TEXT,
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsReplicaSsl" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsReplicaTrustServerCertificate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "sourceAnalyticsReplicaMaxLagSeconds" INTEGER NOT NULL DEFAULT 60;

ALTER TABLE "AnalyticsRoute"
  ADD COLUMN IF NOT EXISTS "workloadClass" TEXT NOT NULL DEFAULT 'POSTGRES_READ_MODEL',
  ADD COLUMN IF NOT EXISTS "useReplica" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS "AnalyticsRoute_workloadClass_enabled_idx"
  ON "AnalyticsRoute" ("workloadClass", "enabled");
