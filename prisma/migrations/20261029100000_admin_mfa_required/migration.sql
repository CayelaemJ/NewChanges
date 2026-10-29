ALTER TABLE "User" ADD COLUMN "mfaSecretEncrypted" TEXT, ADD COLUMN "mfaEnabledAt" TIMESTAMP(3), ADD COLUMN "mfaPendingSecretEncrypted" TEXT, ADD COLUMN "mfaSetupExpiresAt" TIMESTAMP(3);
ALTER TABLE "Session" ADD COLUMN "mfaVerifiedAt" TIMESTAMP(3);
CREATE TABLE "AdminMfaRecoveryCode" ("id" TEXT NOT NULL,"userId" TEXT NOT NULL,"codeHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "AdminMfaRecoveryCode_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "AdminMfaRecoveryCode_userId_codeHash_key" ON "AdminMfaRecoveryCode"("userId","codeHash");
CREATE INDEX "AdminMfaRecoveryCode_userId_createdAt_idx" ON "AdminMfaRecoveryCode"("userId","createdAt");
ALTER TABLE "AdminMfaRecoveryCode" ADD CONSTRAINT "AdminMfaRecoveryCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
