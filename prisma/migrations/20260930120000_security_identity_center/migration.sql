-- Security and identity telemetry.
-- Idempotent: the objects below are also created by the 00000000000000_baseline
-- migration, so this file must be safe to re-run on an existing database.
ALTER TABLE "Session"
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "endedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "revokedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "revokedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "ipAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "userAgent" TEXT,
  ADD COLUMN IF NOT EXISTS "deviceType" TEXT,
  ADD COLUMN IF NOT EXISTS "browser" TEXT,
  ADD COLUMN IF NOT EXISTS "operatingSystem" TEXT,
  ADD COLUMN IF NOT EXISTS "country" TEXT,
  ADD COLUMN IF NOT EXISTS "region" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT;

ALTER TABLE "AdminAuditLog"
  ADD COLUMN IF NOT EXISTS "ipAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "userAgent" TEXT,
  ADD COLUMN IF NOT EXISTS "deviceType" TEXT,
  ADD COLUMN IF NOT EXISTS "country" TEXT,
  ADD COLUMN IF NOT EXISTS "region" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "riskLevel" TEXT NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "impactCount" INTEGER,
  ADD COLUMN IF NOT EXISTS "flagged" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS "LoginEvent" (
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

DO $$ BEGIN
  CREATE TYPE "SecuritySeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "SecurityAlert" (
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

CREATE INDEX IF NOT EXISTS "Session_userId_createdAt_idx" ON "Session"("userId","createdAt");
CREATE INDEX IF NOT EXISTS "Session_userId_lastSeenAt_idx" ON "Session"("userId","lastSeenAt");
CREATE INDEX IF NOT EXISTS "Session_expiresAt_idx" ON "Session"("expiresAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_actorEmail_createdAt_idx" ON "AdminAuditLog"("actorEmail","createdAt");
CREATE INDEX IF NOT EXISTS "AdminAuditLog_riskLevel_flagged_createdAt_idx" ON "AdminAuditLog"("riskLevel","flagged","createdAt");
CREATE INDEX IF NOT EXISTS "LoginEvent_createdAt_idx" ON "LoginEvent"("createdAt");
CREATE INDEX IF NOT EXISTS "LoginEvent_email_createdAt_idx" ON "LoginEvent"("email","createdAt");
CREATE INDEX IF NOT EXISTS "LoginEvent_userId_createdAt_idx" ON "LoginEvent"("userId","createdAt");
CREATE INDEX IF NOT EXISTS "LoginEvent_success_createdAt_idx" ON "LoginEvent"("success","createdAt");
CREATE INDEX IF NOT EXISTS "LoginEvent_ipAddress_createdAt_idx" ON "LoginEvent"("ipAddress","createdAt");
CREATE INDEX IF NOT EXISTS "SecurityAlert_status_severity_createdAt_idx" ON "SecurityAlert"("status","severity","createdAt");
CREATE INDEX IF NOT EXISTS "SecurityAlert_userId_createdAt_idx" ON "SecurityAlert"("userId","createdAt");
CREATE INDEX IF NOT EXISTS "SecurityAlert_actorEmail_createdAt_idx" ON "SecurityAlert"("actorEmail","createdAt");

DO $$ BEGIN
  ALTER TABLE "LoginEvent"
    ADD CONSTRAINT "LoginEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "SecurityAlert"
    ADD CONSTRAINT "SecurityAlert_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
