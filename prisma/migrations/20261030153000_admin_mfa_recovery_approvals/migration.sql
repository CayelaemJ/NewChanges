-- Staged, additive recovery-request persistence for two verified superadmins.
CREATE TABLE "AdminMfaRecoveryRequest" (
  "id" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "requestedById" TEXT NOT NULL,
  "approvedById" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "fulfilledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminMfaRecoveryRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminMfaRecoveryRequest_targetUserId_expiresAt_fulfilledAt_idx" ON "AdminMfaRecoveryRequest"("targetUserId","expiresAt","fulfilledAt");
CREATE INDEX "AdminMfaRecoveryRequest_requestedById_expiresAt_idx" ON "AdminMfaRecoveryRequest"("requestedById","expiresAt");
ALTER TABLE "AdminMfaRecoveryRequest" ADD CONSTRAINT "AdminMfaRecoveryRequest_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
