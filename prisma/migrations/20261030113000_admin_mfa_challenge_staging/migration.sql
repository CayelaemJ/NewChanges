-- Staging only: verification routes and MFA enforcement not activated.
CREATE TABLE "AdminMfaChallenge" (
 "id" TEXT NOT NULL,
 "userId" TEXT NOT NULL,
 "sessionId" TEXT NOT NULL,
 "challengeHash" TEXT NOT NULL,
 "purpose" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL,
 "consumedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "AdminMfaChallenge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AdminMfaChallenge_challengeHash_key" ON "AdminMfaChallenge"("challengeHash");
CREATE INDEX "AdminMfaChallenge_userId_sessionId_purpose_expiresAt_idx" ON "AdminMfaChallenge"("userId","sessionId","purpose","expiresAt");
ALTER TABLE "AdminMfaChallenge" ADD CONSTRAINT "AdminMfaChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdminMfaChallenge" ADD CONSTRAINT "AdminMfaChallenge_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
