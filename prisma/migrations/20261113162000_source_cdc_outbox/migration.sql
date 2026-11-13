-- Minimal application-owned CDC metadata, never source reporting rows.
CREATE TABLE "SourceCdcCheckpoint" (
    "id" TEXT NOT NULL,
    "cursor" TEXT NOT NULL DEFAULT '',
    "leaseOwner" TEXT,
    "leaseGeneration" INTEGER NOT NULL DEFAULT 0,
    "leaseExpiresAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SourceCdcCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SourceCdcOutbox" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceCursor" TEXT NOT NULL,
    "employerRef" TEXT NOT NULL,
    "period" TEXT NOT NULL DEFAULT '',
    "feed" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    CONSTRAINT "SourceCdcOutbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SourceCdcOutbox_sourceId_deliveredAt_createdAt_idx"
  ON "SourceCdcOutbox"("sourceId", "deliveredAt", "createdAt");
CREATE INDEX "SourceCdcOutbox_employerRef_period_idx"
  ON "SourceCdcOutbox"("employerRef", "period");
