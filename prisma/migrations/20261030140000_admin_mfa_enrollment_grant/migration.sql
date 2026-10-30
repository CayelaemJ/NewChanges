-- Additive staged MFA enrollment authorisation grant; raw code is never persisted.
CREATE TABLE "AdminMfaEnrollmentGrant" (
 "id" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "codeHash" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "consumedAt" TIMESTAMP(3),
 "approvedByOne" TEXT NOT NULL,
 "approvedByTwo" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AdminMfaEnrollmentGrant_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminMfaEnrollmentGrant_codeHash_key" ON "AdminMfaEnrollmentGrant"("codeHash");
CREATE INDEX "AdminMfaEnrollmentGrant_userId_expiresAt_consumedAt_idx" ON "AdminMfaEnrollmentGrant"("userId","expiresAt","consumedAt");
ALTER TABLE "AdminMfaEnrollmentGrant" ADD CONSTRAINT "AdminMfaEnrollmentGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
