-- Security and identity telemetry
ALTER TABLE "Session"
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "endedAt" TIMESTAMP(3),
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "revokedBy" TEXT,
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "userAgent" TEXT,
  ADD COLUMN "deviceType" TEXT,
  ADD COLUMN "browser" TEXT,
  ADD COLUMN "operatingSystem" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "region" TEXT,
  ADD COLUMN "city" TEXT;

ALTER TABLE "AdminAuditLog"
  ADD COLUMN "ipAddress" TEXT,
  ADD COLUMN "userAgent" TEXT,
  ADD COLUMN "deviceType" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "region" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "riskLevel" TEXT NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "impactCount" INTEGER,
  ADD COLUMN "flagged" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE "LoginEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "email" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "failureReason" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "deviceType" TEXT,
  "browser" TEXT,
  "operatingSystem" TEXT,
  "country" TEXT,
  "region" TEXT,
  "city" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

CREATE TYPE "SecuritySeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');

CREATE TABLE "SecurityAlert" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "actorEmail" TEXT,
  "type" TEXT NOT NULL,
  "severity" "SecuritySeverity" NOT NULL DEFAULT 'WARNING',
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "title" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "detail" JSONB,
  "impactCount" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "resolvedBy" TEXT,
  CONSTRAINT "SecurityAlert_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Session_userId_createdAt_idx" ON "Session"("userId","createdAt");
CREATE INDEX "Session_userId_lastSeenAt_idx" ON "Session"("userId","lastSeenAt");
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX "AdminAuditLog_actorEmail_createdAt_idx" ON "AdminAuditLog"("actorEmail","createdAt");
CREATE INDEX "AdminAuditLog_riskLevel_flagged_createdAt_idx" ON "AdminAuditLog"("riskLevel","flagged","createdAt");
CREATE INDEX "LoginEvent_createdAt_idx" ON "LoginEvent"("createdAt");
CREATE INDEX "LoginEvent_email_createdAt_idx" ON "LoginEvent"("email","createdAt");
CREATE INDEX "LoginEvent_userId_createdAt_idx" ON "LoginEvent"("userId","createdAt");
CREATE INDEX "LoginEvent_success_createdAt_idx" ON "LoginEvent"("success","createdAt");
CREATE INDEX "LoginEvent_ipAddress_createdAt_idx" ON "LoginEvent"("ipAddress","createdAt");
CREATE INDEX "SecurityAlert_status_severity_createdAt_idx" ON "SecurityAlert"("status","severity","createdAt");
CREATE INDEX "SecurityAlert_userId_createdAt_idx" ON "SecurityAlert"("userId","createdAt");
CREATE INDEX "SecurityAlert_actorEmail_createdAt_idx" ON "SecurityAlert"("actorEmail","createdAt");

ALTER TABLE "LoginEvent"
  ADD CONSTRAINT "LoginEvent_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SecurityAlert"
  ADD CONSTRAINT "SecurityAlert_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
