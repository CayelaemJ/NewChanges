-- Additive TOTP factor storage; no data migration or existing-admin bypass.
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "mfaMethod" TEXT;

CREATE TABLE IF NOT EXISTS "AdminMfaTotp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secretCiphertext" TEXT,
    "pendingCiphertext" TEXT,
    "pendingExpiresAt" TIMESTAMP(3),
    "enabledAt" TIMESTAMP(3),
    "lastUsedStep" BIGINT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastFailedAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AdminMfaTotp_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "AdminMfaTotp_userId_key" ON "AdminMfaTotp"("userId");
CREATE INDEX IF NOT EXISTS "AdminMfaTotp_enabledAt_idx" ON "AdminMfaTotp"("enabledAt");
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AdminMfaTotp_userId_fkey') THEN
    ALTER TABLE "AdminMfaTotp" ADD CONSTRAINT "AdminMfaTotp_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
