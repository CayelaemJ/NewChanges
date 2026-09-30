-- Enterprise source analytics routing: explicit MySQL read-replica controls and workload classification.
ALTER TABLE "IntegrationConfig"
  ADD COLUMN "sqlReplicaEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sqlReplicaHost" TEXT,
  ADD COLUMN "sqlReplicaPort" INTEGER,
  ADD COLUMN "sqlReplicaDatabase" TEXT,
  ADD COLUMN "sqlReplicaSchema" TEXT,
  ADD COLUMN "sqlReplicaUsername" TEXT,
  ADD COLUMN "sqlReplicaPassword" TEXT,
  ADD COLUMN "sqlReplicaSsl" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "sqlReplicaTrustServerCertificate" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sqlReplicaMaxLagSeconds" INTEGER NOT NULL DEFAULT 120;

ALTER TABLE "AnalyticsRoute"
  ADD COLUMN "workloadClass" TEXT NOT NULL DEFAULT 'POSTGRES_READ_MODEL',
  ADD COLUMN "useReplica" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "AnalyticsRoute_workloadClass_enabled_idx"
  ON "AnalyticsRoute"("workloadClass", "enabled");
