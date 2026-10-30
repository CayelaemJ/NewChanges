-- Staged schema only. Does not enable MFA or modify live sessions.
ALTER TABLE "Session" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);
CREATE TABLE "AdminMfaCredential" (
 "id" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "credentialId" TEXT NOT NULL,
 "publicKey" TEXT NOT NULL,
 "signCount" BIGINT NOT NULL DEFAULT 0,
 "transports" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lastUsedAt" TIMESTAMP(3),
 "revokedAt" TIMESTAMP(3),
 CONSTRAINT "AdminMfaCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminMfaCredential_credentialId_key" ON "AdminMfaCredential"("credentialId");
CREATE INDEX "AdminMfaCredential_userId_revokedAt_idx" ON "AdminMfaCredential"("userId","revokedAt");
ALTER TABLE "AdminMfaCredential" ADD CONSTRAINT "AdminMfaCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
