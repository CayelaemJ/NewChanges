-- POPIA governance controls: processing register, data subject requests,
-- operator/vendor register, retention policy register and security incidents.

CREATE TABLE IF NOT EXISTS "ProcessingActivity" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "purpose" TEXT NOT NULL,
  "lawfulBasis" TEXT NOT NULL,
  "partyRole" TEXT NOT NULL,
  "dataSubjects" TEXT NOT NULL,
  "dataCategories" TEXT NOT NULL,
  "specialPersonalInfo" BOOLEAN NOT NULL DEFAULT FALSE,
  "childrenData" BOOLEAN NOT NULL DEFAULT FALSE,
  "automatedDecision" BOOLEAN NOT NULL DEFAULT FALSE,
  "profiling" BOOLEAN NOT NULL DEFAULT FALSE,
  "recipients" TEXT,
  "source" TEXT,
  "retentionPolicy" TEXT,
  "crossBorder" BOOLEAN NOT NULL DEFAULT FALSE,
  "crossBorderBasis" TEXT,
  "operatorAgreementRef" TEXT,
  "piaStatus" TEXT NOT NULL DEFAULT 'REQUIRED',
  "owner" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "reviewedAt" TIMESTAMP(3),
  "nextReviewAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProcessingActivity_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProcessingActivity_active_idx" ON "ProcessingActivity" ("active");
CREATE INDEX IF NOT EXISTS "ProcessingActivity_partyRole_idx" ON "ProcessingActivity" ("partyRole");
CREATE INDEX IF NOT EXISTS "ProcessingActivity_crossBorder_idx" ON "ProcessingActivity" ("crossBorder");
CREATE INDEX IF NOT EXISTS "ProcessingActivity_nextReviewAt_idx" ON "ProcessingActivity" ("nextReviewAt");

CREATE TABLE IF NOT EXISTS "DataSubjectRequest" (
  "id" TEXT NOT NULL,
  "requestType" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "requesterEmail" TEXT NOT NULL,
  "requesterName" TEXT,
  "employerId" TEXT,
  "description" TEXT,
  "identityVerified" BOOLEAN NOT NULL DEFAULT FALSE,
  "identityVerifiedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "dueAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "resolutionNotes" TEXT,
  "assignedTo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DataSubjectRequest_status_dueAt_idx" ON "DataSubjectRequest" ("status", "dueAt");
CREATE INDEX IF NOT EXISTS "DataSubjectRequest_requesterEmail_createdAt_idx" ON "DataSubjectRequest" ("requesterEmail", "createdAt");
CREATE INDEX IF NOT EXISTS "DataSubjectRequest_employerId_createdAt_idx" ON "DataSubjectRequest" ("employerId", "createdAt");
DO $$ BEGIN
  ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_employerId_fkey"
    FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "ComplianceVendor" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "processingPurpose" TEXT NOT NULL,
  "dataCategories" TEXT NOT NULL,
  "country" TEXT NOT NULL,
  "crossBorder" BOOLEAN NOT NULL DEFAULT FALSE,
  "transferBasis" TEXT,
  "operatorAgreement" BOOLEAN NOT NULL DEFAULT FALSE,
  "securityReview" BOOLEAN NOT NULL DEFAULT FALSE,
  "subprocessorsKnown" BOOLEAN NOT NULL DEFAULT FALSE,
  "approved" BOOLEAN NOT NULL DEFAULT FALSE,
  "reviewNotes" TEXT,
  "lastReviewedAt" TIMESTAMP(3),
  "nextReviewAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ComplianceVendor_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ComplianceVendor_approved_crossBorder_idx" ON "ComplianceVendor" ("approved", "crossBorder");
CREATE INDEX IF NOT EXISTS "ComplianceVendor_nextReviewAt_idx" ON "ComplianceVendor" ("nextReviewAt");

CREATE TABLE IF NOT EXISTS "RetentionPolicy" (
  "id" TEXT NOT NULL,
  "dataClass" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "retentionDays" INTEGER,
  "retentionRule" TEXT NOT NULL,
  "deletionMethod" TEXT NOT NULL,
  "legalBasis" TEXT,
  "legalHold" BOOLEAN NOT NULL DEFAULT FALSE,
  "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "reviewedAt" TIMESTAMP(3),
  "nextReviewAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RetentionPolicy_dataClass_key" ON "RetentionPolicy" ("dataClass");
CREATE INDEX IF NOT EXISTS "RetentionPolicy_active_nextReviewAt_idx" ON "RetentionPolicy" ("active", "nextReviewAt");

CREATE TABLE IF NOT EXISTS "SecurityIncident" (
  "id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DETECTED',
  "severity" TEXT NOT NULL DEFAULT 'HIGH',
  "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "containedAt" TIMESTAMP(3),
  "regulatorNotifiedAt" TIMESTAMP(3),
  "dataSubjectsNotifiedAt" TIMESTAMP(3),
  "responsibleParty" TEXT,
  "informationOfficer" TEXT,
  "regulatorReference" TEXT,
  "affectedDataClasses" TEXT,
  "affectedSubjectsCount" INTEGER,
  "rootCause" TEXT,
  "mitigation" TEXT,
  "evidenceLocation" TEXT,
  "assignedTo" TEXT,
  "resolvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SecurityIncident_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SecurityIncident_status_severity_discoveredAt_idx" ON "SecurityIncident" ("status", "severity", "discoveredAt");
CREATE INDEX IF NOT EXISTS "SecurityIncident_regulatorNotifiedAt_idx" ON "SecurityIncident" ("regulatorNotifiedAt");

ALTER TABLE "Employer" ADD COLUMN IF NOT EXISTS "dataSubjectRequestsEnabled" BOOLEAN NOT NULL DEFAULT TRUE;
