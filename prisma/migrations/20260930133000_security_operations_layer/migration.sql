-- Security operations telemetry: device grouping, IP geography cache and sensitive API access audit.
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "deviceKey" TEXT;
ALTER TABLE "LoginEvent" ADD COLUMN IF NOT EXISTS "deviceKey" TEXT;

CREATE INDEX IF NOT EXISTS "Session_deviceKey_lastSeenAt_idx" ON "Session" ("deviceKey", "lastSeenAt");
CREATE INDEX IF NOT EXISTS "LoginEvent_deviceKey_createdAt_idx" ON "LoginEvent" ("deviceKey", "createdAt");

CREATE TABLE IF NOT EXISTS "IpGeolocationCache" (
  "id" TEXT NOT NULL,
  "ipHash" TEXT NOT NULL,
  "country" TEXT,
  "region" TEXT,
  "city" TEXT,
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "provider" TEXT,
  "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "IpGeolocationCache_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "IpGeolocationCache_ipHash_key" ON "IpGeolocationCache" ("ipHash");
CREATE INDEX IF NOT EXISTS "IpGeolocationCache_expiresAt_idx" ON "IpGeolocationCache" ("expiresAt");

CREATE TABLE IF NOT EXISTS "DataAccessEvent" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "actorEmail" TEXT,
  "method" TEXT NOT NULL,
  "route" TEXT NOT NULL,
  "resource" TEXT,
  "employerId" TEXT,
  "ipAddress" TEXT,
  "deviceKey" TEXT,
  "deviceType" TEXT,
  "statusCode" INTEGER,
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataAccessEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DataAccessEvent_createdAt_idx" ON "DataAccessEvent" ("createdAt");
CREATE INDEX IF NOT EXISTS "DataAccessEvent_userId_createdAt_idx" ON "DataAccessEvent" ("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "DataAccessEvent_route_createdAt_idx" ON "DataAccessEvent" ("route", "createdAt");
CREATE INDEX IF NOT EXISTS "DataAccessEvent_actorEmail_createdAt_idx" ON "DataAccessEvent" ("actorEmail", "createdAt");

DO $$ BEGIN
  ALTER TABLE "DataAccessEvent" ADD CONSTRAINT "DataAccessEvent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
