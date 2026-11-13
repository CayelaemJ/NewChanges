-- Control-plane only: restart-safe invalidation watermark per source/employer.
CREATE TABLE "SourceCdcVersion" (
  "sourceId" TEXT NOT NULL,
  "employerRef" TEXT NOT NULL,
  "version" BIGINT NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SourceCdcVersion_pkey" PRIMARY KEY ("sourceId","employerRef")
);
