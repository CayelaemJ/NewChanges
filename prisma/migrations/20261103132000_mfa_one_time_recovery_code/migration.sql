-- Additive one-time recovery material. Raw keys never enter the database.
CREATE TABLE "AdminMfaRecoveryCode" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "usedAt" TIMESTAMP(3),
  CONSTRAINT "AdminMfaRecoveryCode_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminMfaRecoveryCode_userId_key" ON "AdminMfaRecoveryCode"("userId");
CREATE UNIQUE INDEX "AdminMfaRecoveryCode_codeHash_key" ON "AdminMfaRecoveryCode"("codeHash");
ALTER TABLE "AdminMfaRecoveryCode" ADD CONSTRAINT "AdminMfaRecoveryCode_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminMfaEnrollmentRequest" ADD COLUMN "recoveryVerifiedAt" TIMESTAMP(3);
