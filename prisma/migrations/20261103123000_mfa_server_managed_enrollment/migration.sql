-- Additive MFA enrollment authorization. No credentials, tokens, or one-time
-- enrollment secrets are stored in this table. Approval is bound to an
-- administrator's active password-authenticated login session.
CREATE TABLE "AdminMfaEnrollmentRequest" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "approvedByOne" TEXT,
  "approvedByTwo" TEXT,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AdminMfaEnrollmentRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminMfaEnrollmentRequest_userId_sessionId_expiresAt_consumedAt_idx"
  ON "AdminMfaEnrollmentRequest"("userId", "sessionId", "expiresAt", "consumedAt");
CREATE INDEX "AdminMfaEnrollmentRequest_expiresAt_approvedByTwo_idx"
  ON "AdminMfaEnrollmentRequest"("expiresAt", "approvedByTwo");
ALTER TABLE "AdminMfaEnrollmentRequest" ADD CONSTRAINT
  "AdminMfaEnrollmentRequest_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
