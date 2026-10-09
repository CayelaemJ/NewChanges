-- CreateEnum
CREATE TYPE "IncomeBand" AS ENUM ('UNDER_5K', 'BAND_5_10K', 'BAND_10_20K', 'BAND_20_40K', 'OVER_40K');

-- CreateEnum
CREATE TYPE "JourneyType" AS ENUM ('CREDIT_LIFE', 'FUNERAL', 'SHORT_TERM', 'ARREARS', 'PRESCRIBED', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('STARTED', 'IN_PROGRESS', 'COMPLETED', 'GUIDANCE_ONLY', 'ABANDONED');

-- CreateEnum
CREATE TYPE "CreditType" AS ENUM ('BANK_LOAN', 'RETAIL_STORE', 'MICROLOAN', 'OTHER_UNSECURED');

-- CreateEnum
CREATE TYPE "DebtState" AS ENUM ('NONE', 'ACTIVE_INTERVENTION', 'CHALLENGED', 'GUIDED');

-- CreateEnum
CREATE TYPE "ChallengeStatus" AS ENUM ('IDENTIFIED', 'LETTER_SENT', 'CREDITOR_CONCEDED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "PolicyType" AS ENUM ('CREDIT_LIFE', 'FUNERAL', 'SHORT_TERM');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('FINALISED', 'PENDING', 'DECLINED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'SUPERADMIN', 'EMPLOYER_MANAGER', 'PORTFOLIO_MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "AnalyticsEventType" AS ENUM ('PAGEVIEW', 'SCROLL_DEPTH', 'SESSION_END', 'CTA_CLICK', 'FORM_SUBMIT', 'OUTBOUND_CLICK', 'CLIENT_ERROR');

-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('ONCE', 'DAILY', 'WEEKLY', 'MONTHLY');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('UPLOADED', 'VALIDATED', 'COMMITTED', 'FAILED', 'REVERTED');

-- CreateEnum
CREATE TYPE "ScoreDriver" AS ENUM ('ENGAGEMENT', 'CASHFLOW', 'DEBT_RISK', 'INSURANCE');

-- CreateEnum
CREATE TYPE "SecuritySeverity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');

-- CreateTable
CREATE TABLE "Employer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "eligibleCount" INTEGER NOT NULL DEFAULT 0,
    "eligibleCountAsAt" TIMESTAMP(3),
    "partnerId" TEXT,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dataSubjectRequestsEnabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Employer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerHeadcountSnapshot" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "eligibleCount" INTEGER NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDeletedAt" TIMESTAMP(3),
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployerHeadcountSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Employee" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "siteId" TEXT,
    "payrollRef" TEXT NOT NULL,
    "incomeBand" "IncomeBand",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "eligibleFrom" TIMESTAMP(3),
    "eligibleTo" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDeletedAt" TIMESTAMP(3),
    "importBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeVersion" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "siteName" TEXT,
    "incomeBand" "IncomeBand",
    "active" BOOLEAN NOT NULL DEFAULT true,
    "eligibleFrom" TIMESTAMP(3) NOT NULL,
    "eligibleTo" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformUser" (
    "id" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "hasCreditProfile" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDeletedAt" TIMESTAMP(3),
    "importBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Journey" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "type" "JourneyType" NOT NULL,
    "status" "JourneyStatus" NOT NULL DEFAULT 'STARTED',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "monthlySavingCents" INTEGER,
    "balanceImpactCents" INTEGER,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDeletedAt" TIMESTAMP(3),
    "importBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyEvent" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtAccount" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "journeyId" TEXT,
    "creditorName" TEXT NOT NULL,
    "creditType" "CreditType" NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "inArrears" BOOLEAN NOT NULL DEFAULT false,
    "state" "DebtState" NOT NULL DEFAULT 'NONE',
    "challengeStatus" "ChallengeStatus",
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDeletedAt" TIMESTAMP(3),
    "importBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DebtAccountVersion" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "creditorName" TEXT NOT NULL,
    "creditType" "CreditType" NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "inArrears" BOOLEAN NOT NULL,
    "state" "DebtState" NOT NULL,
    "challengeStatus" "ChallengeStatus",
    "journeyId" TEXT,
    "closedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DebtAccountVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsurancePolicy" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "type" "PolicyType" NOT NULL,
    "premiumCents" INTEGER NOT NULL,
    "isWasteful" BOOLEAN NOT NULL DEFAULT false,
    "isResolved" BOOLEAN NOT NULL DEFAULT false,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDeletedAt" TIMESTAMP(3),
    "importBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsurancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InsurancePolicyVersion" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "type" "PolicyType" NOT NULL,
    "premiumCents" INTEGER NOT NULL,
    "isWasteful" BOOLEAN NOT NULL,
    "isResolved" BOOLEAN NOT NULL,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsurancePolicyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "journeyType" "JourneyType",
    "stars" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDeletedAt" TIMESTAMP(3),
    "importBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatSession" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "employeeId" TEXT,
    "journeyType" "JourneyType",
    "resolvedInChat" BOOLEAN NOT NULL DEFAULT false,
    "firstReplySeconds" INTEGER,
    "satisfaction" INTEGER,
    "sentiment" DOUBLE PRECISION,
    "theme" TEXT,
    "primaryQuestion" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDeletedAt" TIMESTAMP(3),
    "importBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "id" TEXT NOT NULL,
    "platformUserId" TEXT NOT NULL,
    "channel" TEXT,
    "sharedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "converted" BOOLEAN NOT NULL DEFAULT false,
    "convertedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDeletedAt" TIMESTAMP(3),
    "importBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreSnapshot" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rangeStart" TIMESTAMP(3),
    "rangeEnd" TIMESTAMP(3),
    "asAt" TIMESTAMP(3),
    "payloadVersion" INTEGER NOT NULL DEFAULT 3,
    "optimiseScore" INTEGER NOT NULL,
    "rawScore" DOUBLE PRECISION NOT NULL,
    "engagementScore" INTEGER NOT NULL,
    "cashflowScore" INTEGER NOT NULL,
    "debtRiskScore" INTEGER NOT NULL,
    "insuranceScore" INTEGER NOT NULL,
    "engagementWeight" DOUBLE PRECISION NOT NULL,
    "cashflowWeight" DOUBLE PRECISION NOT NULL,
    "debtRiskWeight" DOUBLE PRECISION NOT NULL,
    "insuranceWeight" DOUBLE PRECISION NOT NULL,
    "payload" JSONB NOT NULL,

    CONSTRAINT "ScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardCohortCache" (
    "id" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "period" TEXT,
    "range" TEXT,
    "site" TEXT,
    "income" TEXT,
    "asAt" TIMESTAMP(3),
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "optimiseScore" INTEGER,
    "payload" JSONB NOT NULL,

    CONSTRAINT "DashboardCohortCache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryAdvance" (
    "id" TEXT NOT NULL,
    "advanceRef" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "employeeId" TEXT,
    "clientId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'FINALISED',
    "bankVerified" BOOLEAN NOT NULL DEFAULT true,
    "blacklisted" BOOLEAN NOT NULL DEFAULT false,
    "advancedAt" TIMESTAMP(3) NOT NULL,
    "sourceUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDeletedAt" TIMESTAMP(3),
    "importBatchId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "sourceMode" TEXT NOT NULL DEFAULT 'API',
    "baseUrl" TEXT,
    "authToken" TEXT,
    "sqlDialect" TEXT NOT NULL DEFAULT 'POSTGRESQL',
    "sqlHost" TEXT,
    "sqlPort" INTEGER,
    "sqlDatabase" TEXT,
    "sqlSchema" TEXT,
    "sqlUsername" TEXT,
    "sqlPassword" TEXT,
    "sqlSsl" BOOLEAN NOT NULL DEFAULT true,
    "sqlTrustServerCertificate" BOOLEAN NOT NULL DEFAULT false,
    "sqlViewPrefix" TEXT NOT NULL DEFAULT 'v_',
    "sqlQueryTimeoutMs" INTEGER NOT NULL DEFAULT 60000,
    "sqlMaxRowsPerReport" INTEGER NOT NULL DEFAULT 250000,
    "analyticsMode" TEXT NOT NULL DEFAULT 'POSTGRES_READ_MODEL',
    "sourceAnalyticsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sourceAnalyticsReadOnly" BOOLEAN NOT NULL DEFAULT true,
    "sourceAnalyticsUseReplica" BOOLEAN NOT NULL DEFAULT false,
    "sourceAnalyticsNote" TEXT,
    "sourceAnalyticsReplicaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "sourceAnalyticsReplicaHost" TEXT,
    "sourceAnalyticsReplicaPort" INTEGER,
    "sourceAnalyticsReplicaDatabase" TEXT,
    "sourceAnalyticsReplicaSchema" TEXT,
    "sourceAnalyticsReplicaUsername" TEXT,
    "sourceAnalyticsReplicaPassword" TEXT,
    "sourceAnalyticsReplicaSsl" BOOLEAN NOT NULL DEFAULT true,
    "sourceAnalyticsReplicaTrustServerCertificate" BOOLEAN NOT NULL DEFAULT false,
    "sourceAnalyticsReplicaMaxLagSeconds" INTEGER NOT NULL DEFAULT 60,
    "scheduleHours" INTEGER NOT NULL DEFAULT 1,
    "lastSyncAt" TIMESTAMP(3),
    "lastSuccessfulSyncAt" TIMESTAMP(3),
    "lastSyncStatus" TEXT,
    "lastSyncNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsRoute" (
    "id" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "executionMode" TEXT NOT NULL DEFAULT 'POSTGRES',
    "workloadClass" TEXT NOT NULL DEFAULT 'POSTGRES_READ_MODEL',
    "sourceView" TEXT,
    "useReplica" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "rationale" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsRoute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "throughAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "trigger" TEXT NOT NULL DEFAULT 'manual',
    "summary" JSONB,
    "note" TEXT,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MLOpsEvent" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "modelVersion" TEXT NOT NULL,
    "employerId" TEXT,
    "period" TEXT,
    "metric" TEXT,
    "actualValue" DOUBLE PRECISION,
    "predictedValue" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "driftScore" DOUBLE PRECISION,
    "anomalyScore" DOUBLE PRECISION,
    "status" TEXT,
    "feedback" TEXT,
    "features" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MLOpsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MLOpsModel" (
    "id" TEXT NOT NULL,
    "modelKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "modelType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SHADOW',
    "trainingVersion" TEXT,
    "metrics" JSONB,
    "featureSchema" JSONB,
    "promotedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MLOpsModel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntegrationCursor" (
    "reportKey" TEXT NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastSourceUpdatedAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntegrationCursor_pkey" PRIMARY KEY ("reportKey")
);

-- CreateTable
CREATE TABLE "BrandLearningState" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "engineVersion" TEXT NOT NULL,
    "uploadCount" INTEGER NOT NULL DEFAULT 0,
    "labelledCount" INTEGER NOT NULL DEFAULT 0,
    "acceptedCount" INTEGER NOT NULL DEFAULT 0,
    "averageConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "huePrior" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrandLearningState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "displayName" TEXT,
    "primaryColor" TEXT,
    "accentColor" TEXT,
    "navyColor" TEXT,
    "logoDataUrl" TEXT,
    "tagline" TEXT,
    "brandEngineVersion" TEXT,
    "brandDetectionStatus" TEXT DEFAULT 'UNREVIEWED',
    "brandDetectionConfidence" DOUBLE PRECISION,
    "brandDetectionWarnings" JSONB,
    "brandDetectionDiagnostics" JSONB,
    "brandDetectedPalette" JSONB,
    "brandDetectedAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYER_MANAGER',
    "passwordHash" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "setupToken" TEXT,
    "setupExpires" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "partnerId" TEXT,
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "revokedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "type" "AnalyticsEventType" NOT NULL,
    "path" TEXT NOT NULL,
    "value" INTEGER,
    "partnerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserEmployer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,

    CONSTRAINT "UserEmployer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardSection" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowedRoles" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DashboardSection_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "UserSectionAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sectionKey" TEXT NOT NULL,

    CONSTRAINT "UserSectionAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedBy" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceType" TEXT,
    "browser" TEXT,
    "operatingSystem" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "deviceKey" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemEmailConfig" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "smtpHost" TEXT,
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpSecure" BOOLEAN NOT NULL DEFAULT false,
    "smtpRequireTls" BOOLEAN NOT NULL DEFAULT true,
    "smtpRejectUnauthorized" BOOLEAN NOT NULL DEFAULT true,
    "smtpUsername" TEXT,
    "smtpPassword" TEXT,
    "fromName" TEXT NOT NULL DEFAULT 'empower-fin Dashboard Portal',
    "fromEmail" TEXT,
    "replyTo" TEXT,
    "defaultTimezone" TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
    "portalBaseUrl" TEXT,
    "lastTestAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastTestNote" TEXT,
    "emailProvider" TEXT NOT NULL DEFAULT 'smtp',
    "resendApiKey" TEXT,
    "alertEmails" TEXT,
    "alertSlackWebhookUrl" TEXT,
    "digestEnabled" BOOLEAN NOT NULL DEFAULT false,
    "lastDigestSentAt" TIMESTAMP(3),
    "staleDeactivateDays" INTEGER,
    "lastStaleCheckAt" TIMESTAMP(3),
    "scoreChangeAlertsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "syntheticDataMode" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemEmailConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "employerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
    "sendTime" TEXT NOT NULL DEFAULT '08:00',
    "dayOfWeek" INTEGER,
    "dayOfMonth" INTEGER,
    "onceDate" TIMESTAMP(3),
    "filters" JSONB NOT NULL,
    "recipients" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunAt" TIMESTAMP(3),
    "lastSentAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportDeliveryLog" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT,
    "triggeredBy" TEXT NOT NULL DEFAULT 'scheduled',
    "status" TEXT NOT NULL,
    "recipients" JSONB NOT NULL,
    "subject" TEXT,
    "filters" JSONB,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,

    CONSTRAINT "ReportDeliveryLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "reportKey" TEXT NOT NULL,
    "employerRef" TEXT,
    "filename" TEXT NOT NULL,
    "fileFormat" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "insertedCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "deletedCount" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "stagedRows" JSONB,
    "uploadedBy" TEXT,
    "sourceSince" TIMESTAMP(3),
    "sourceThrough" TIMESTAMP(3),
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    "revertedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatchRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowIndex" INTEGER NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "ImportBatchRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScoreWeight" (
    "id" TEXT NOT NULL,
    "employerId" TEXT,
    "driver" "ScoreDriver" NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScoreWeight_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceType" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'NORMAL',
    "impactCount" INTEGER,
    "flagged" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoginEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "email" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL,
    "failureReason" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "deviceType" TEXT,
    "browser" TEXT,
    "operatingSystem" TEXT,
    "country" TEXT,
    "region" TEXT,
    "city" TEXT,
    "deviceKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoginEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityAlert" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actorEmail" TEXT,
    "type" TEXT NOT NULL,
    "severity" "SecuritySeverity" NOT NULL DEFAULT 'WARNING',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "detail" JSONB,
    "impactCount" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,

    CONSTRAINT "SecurityAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpGeolocationCache" (
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

-- CreateTable
CREATE TABLE "DataAccessEvent" (
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

-- CreateTable
CREATE TABLE "ProcessingActivity" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "purpose" TEXT NOT NULL,
    "lawfulBasis" TEXT NOT NULL,
    "partyRole" TEXT NOT NULL,
    "dataSubjects" TEXT NOT NULL,
    "dataCategories" TEXT NOT NULL,
    "specialPersonalInfo" BOOLEAN NOT NULL DEFAULT false,
    "childrenData" BOOLEAN NOT NULL DEFAULT false,
    "automatedDecision" BOOLEAN NOT NULL DEFAULT false,
    "profiling" BOOLEAN NOT NULL DEFAULT false,
    "recipients" TEXT,
    "source" TEXT,
    "retentionPolicy" TEXT,
    "crossBorder" BOOLEAN NOT NULL DEFAULT false,
    "crossBorderBasis" TEXT,
    "operatorAgreementRef" TEXT,
    "piaStatus" TEXT NOT NULL DEFAULT 'REQUIRED',
    "owner" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reviewedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessingActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DataSubjectRequest" (
    "id" TEXT NOT NULL,
    "requestType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "requesterEmail" TEXT NOT NULL,
    "requesterName" TEXT,
    "employerId" TEXT,
    "description" TEXT,
    "identityVerified" BOOLEAN NOT NULL DEFAULT false,
    "identityVerifiedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "assignedTo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DataSubjectRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplianceVendor" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "processingPurpose" TEXT NOT NULL,
    "dataCategories" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "crossBorder" BOOLEAN NOT NULL DEFAULT false,
    "transferBasis" TEXT,
    "operatorAgreement" BOOLEAN NOT NULL DEFAULT false,
    "securityReview" BOOLEAN NOT NULL DEFAULT false,
    "subprocessorsKnown" BOOLEAN NOT NULL DEFAULT false,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "reviewNotes" TEXT,
    "lastReviewedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ComplianceVendor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RetentionPolicy" (
    "id" TEXT NOT NULL,
    "dataClass" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "retentionDays" INTEGER,
    "retentionRule" TEXT NOT NULL,
    "deletionMethod" TEXT NOT NULL,
    "legalBasis" TEXT,
    "legalHold" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "reviewedAt" TIMESTAMP(3),
    "nextReviewAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetentionPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityIncident" (
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
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SecurityIncident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AchievableTarget" (
    "id" TEXT NOT NULL,
    "employerId" TEXT,
    "driver" "ScoreDriver" NOT NULL,
    "config" JSONB NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AchievableTarget_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Employer_name_idx" ON "Employer"("name");

-- CreateIndex
CREATE INDEX "Employer_sourceUpdatedAt_idx" ON "Employer"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "Employer_sourceDeletedAt_idx" ON "Employer"("sourceDeletedAt");

-- CreateIndex
CREATE INDEX "EmployerHeadcountSnapshot_employerId_asOfDate_idx" ON "EmployerHeadcountSnapshot"("employerId", "asOfDate");

-- CreateIndex
CREATE INDEX "EmployerHeadcountSnapshot_sourceUpdatedAt_idx" ON "EmployerHeadcountSnapshot"("sourceUpdatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerHeadcountSnapshot_employerId_asOfDate_key" ON "EmployerHeadcountSnapshot"("employerId", "asOfDate");

-- CreateIndex
CREATE INDEX "Site_employerId_idx" ON "Site"("employerId");

-- CreateIndex
CREATE UNIQUE INDEX "Site_employerId_name_key" ON "Site"("employerId", "name");

-- CreateIndex
CREATE INDEX "Employee_employerId_sourceDeletedAt_observedAt_idx" ON "Employee"("employerId", "sourceDeletedAt", "observedAt");

-- CreateIndex
CREATE INDEX "Employee_employerId_observedAt_idx" ON "Employee"("employerId", "observedAt");

-- CreateIndex
CREATE INDEX "Employee_employerId_siteId_incomeBand_idx" ON "Employee"("employerId", "siteId", "incomeBand");

-- CreateIndex
CREATE INDEX "Employee_siteId_idx" ON "Employee"("siteId");

-- CreateIndex
CREATE INDEX "Employee_eligibleFrom_eligibleTo_idx" ON "Employee"("eligibleFrom", "eligibleTo");

-- CreateIndex
CREATE INDEX "Employee_observedAt_idx" ON "Employee"("observedAt");

-- CreateIndex
CREATE INDEX "Employee_sourceUpdatedAt_idx" ON "Employee"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "Employee_sourceDeletedAt_idx" ON "Employee"("sourceDeletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Employee_employerId_payrollRef_key" ON "Employee"("employerId", "payrollRef");

-- CreateIndex
CREATE INDEX "EmployeeVersion_observedAt_idx" ON "EmployeeVersion"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "EmployeeVersion_employeeId_observedAt_key" ON "EmployeeVersion"("employeeId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformUser_employeeId_key" ON "PlatformUser"("employeeId");

-- CreateIndex
CREATE INDEX "PlatformUser_enrolledAt_idx" ON "PlatformUser"("enrolledAt");

-- CreateIndex
CREATE INDEX "PlatformUser_activatedAt_idx" ON "PlatformUser"("activatedAt");

-- CreateIndex
CREATE INDEX "PlatformUser_employeeId_enrolledAt_idx" ON "PlatformUser"("employeeId", "enrolledAt");

-- CreateIndex
CREATE INDEX "PlatformUser_sourceUpdatedAt_idx" ON "PlatformUser"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "PlatformUser_sourceDeletedAt_idx" ON "PlatformUser"("sourceDeletedAt");

-- CreateIndex
CREATE INDEX "Journey_platformUserId_idx" ON "Journey"("platformUserId");

-- CreateIndex
CREATE INDEX "Journey_platformUserId_startedAt_status_sourceDeletedAt_idx" ON "Journey"("platformUserId", "startedAt", "status", "sourceDeletedAt");

-- CreateIndex
CREATE INDEX "Journey_platformUserId_completedAt_status_sourceDeletedAt_idx" ON "Journey"("platformUserId", "completedAt", "status", "sourceDeletedAt");

-- CreateIndex
CREATE INDEX "Journey_type_status_idx" ON "Journey"("type", "status");

-- CreateIndex
CREATE INDEX "Journey_startedAt_idx" ON "Journey"("startedAt");

-- CreateIndex
CREATE INDEX "Journey_completedAt_idx" ON "Journey"("completedAt");

-- CreateIndex
CREATE INDEX "Journey_sourceUpdatedAt_idx" ON "Journey"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "Journey_sourceDeletedAt_idx" ON "Journey"("sourceDeletedAt");

-- CreateIndex
CREATE INDEX "JourneyEvent_journeyId_idx" ON "JourneyEvent"("journeyId");

-- CreateIndex
CREATE INDEX "JourneyEvent_kind_idx" ON "JourneyEvent"("kind");

-- CreateIndex
CREATE INDEX "JourneyEvent_occurredAt_idx" ON "JourneyEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "DebtAccount_platformUserId_idx" ON "DebtAccount"("platformUserId");

-- CreateIndex
CREATE INDEX "DebtAccount_platformUserId_observedAt_sourceDeletedAt_idx" ON "DebtAccount"("platformUserId", "observedAt", "sourceDeletedAt");

-- CreateIndex
CREATE INDEX "DebtAccount_creditorName_idx" ON "DebtAccount"("creditorName");

-- CreateIndex
CREATE INDEX "DebtAccount_state_idx" ON "DebtAccount"("state");

-- CreateIndex
CREATE INDEX "DebtAccount_inArrears_idx" ON "DebtAccount"("inArrears");

-- CreateIndex
CREATE INDEX "DebtAccount_observedAt_idx" ON "DebtAccount"("observedAt");

-- CreateIndex
CREATE INDEX "DebtAccount_sourceUpdatedAt_idx" ON "DebtAccount"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "DebtAccount_sourceDeletedAt_idx" ON "DebtAccount"("sourceDeletedAt");

-- CreateIndex
CREATE INDEX "DebtAccountVersion_observedAt_idx" ON "DebtAccountVersion"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DebtAccountVersion_accountId_observedAt_key" ON "DebtAccountVersion"("accountId", "observedAt");

-- CreateIndex
CREATE INDEX "InsurancePolicy_platformUserId_observedAt_sourceDeletedAt_idx" ON "InsurancePolicy"("platformUserId", "observedAt", "sourceDeletedAt");

-- CreateIndex
CREATE INDEX "InsurancePolicy_isWasteful_isResolved_idx" ON "InsurancePolicy"("isWasteful", "isResolved");

-- CreateIndex
CREATE INDEX "InsurancePolicy_observedAt_idx" ON "InsurancePolicy"("observedAt");

-- CreateIndex
CREATE INDEX "InsurancePolicy_effectiveFrom_effectiveTo_idx" ON "InsurancePolicy"("effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "InsurancePolicy_sourceUpdatedAt_idx" ON "InsurancePolicy"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "InsurancePolicy_sourceDeletedAt_idx" ON "InsurancePolicy"("sourceDeletedAt");

-- CreateIndex
CREATE INDEX "InsurancePolicyVersion_observedAt_idx" ON "InsurancePolicyVersion"("observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicyVersion_policyId_observedAt_key" ON "InsurancePolicyVersion"("policyId", "observedAt");

-- CreateIndex
CREATE INDEX "Rating_platformUserId_idx" ON "Rating"("platformUserId");

-- CreateIndex
CREATE INDEX "Rating_platformUserId_createdAt_idx" ON "Rating"("platformUserId", "createdAt");

-- CreateIndex
CREATE INDEX "Rating_createdAt_idx" ON "Rating"("createdAt");

-- CreateIndex
CREATE INDEX "Rating_sourceUpdatedAt_idx" ON "Rating"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "Rating_sourceDeletedAt_idx" ON "Rating"("sourceDeletedAt");

-- CreateIndex
CREATE INDEX "ChatSession_employerId_idx" ON "ChatSession"("employerId");

-- CreateIndex
CREATE INDEX "ChatSession_employeeId_idx" ON "ChatSession"("employeeId");

-- CreateIndex
CREATE INDEX "ChatSession_employeeId_startedAt_idx" ON "ChatSession"("employeeId", "startedAt");

-- CreateIndex
CREATE INDEX "ChatSession_startedAt_idx" ON "ChatSession"("startedAt");

-- CreateIndex
CREATE INDEX "ChatSession_sourceUpdatedAt_idx" ON "ChatSession"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "ChatSession_sourceDeletedAt_idx" ON "ChatSession"("sourceDeletedAt");

-- CreateIndex
CREATE INDEX "ChatSession_importBatchId_idx" ON "ChatSession"("importBatchId");

-- CreateIndex
CREATE INDEX "Referral_platformUserId_idx" ON "Referral"("platformUserId");

-- CreateIndex
CREATE INDEX "Referral_platformUserId_sharedAt_idx" ON "Referral"("platformUserId", "sharedAt");

-- CreateIndex
CREATE INDEX "Referral_sharedAt_idx" ON "Referral"("sharedAt");

-- CreateIndex
CREATE INDEX "Referral_sourceUpdatedAt_idx" ON "Referral"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "Referral_sourceDeletedAt_idx" ON "Referral"("sourceDeletedAt");

-- CreateIndex
CREATE INDEX "Referral_importBatchId_idx" ON "Referral"("importBatchId");

-- CreateIndex
CREATE INDEX "ScoreSnapshot_employerId_idx" ON "ScoreSnapshot"("employerId");

-- CreateIndex
CREATE INDEX "ScoreSnapshot_period_idx" ON "ScoreSnapshot"("period");

-- CreateIndex
CREATE INDEX "ScoreSnapshot_asAt_idx" ON "ScoreSnapshot"("asAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScoreSnapshot_employerId_period_key" ON "ScoreSnapshot"("employerId", "period");

-- CreateIndex
CREATE INDEX "DashboardCohortCache_employerId_period_site_income_idx" ON "DashboardCohortCache"("employerId", "period", "site", "income");

-- CreateIndex
CREATE INDEX "DashboardCohortCache_computedAt_idx" ON "DashboardCohortCache"("computedAt");

-- CreateIndex
CREATE UNIQUE INDEX "DashboardCohortCache_employerId_cacheKey_key" ON "DashboardCohortCache"("employerId", "cacheKey");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryAdvance_advanceRef_key" ON "SalaryAdvance"("advanceRef");

-- CreateIndex
CREATE INDEX "SalaryAdvance_employerId_employeeId_advancedAt_idx" ON "SalaryAdvance"("employerId", "employeeId", "advancedAt");

-- CreateIndex
CREATE INDEX "SalaryAdvance_employerId_idx" ON "SalaryAdvance"("employerId");

-- CreateIndex
CREATE INDEX "SalaryAdvance_employeeId_idx" ON "SalaryAdvance"("employeeId");

-- CreateIndex
CREATE INDEX "SalaryAdvance_employeeId_advancedAt_idx" ON "SalaryAdvance"("employeeId", "advancedAt");

-- CreateIndex
CREATE INDEX "SalaryAdvance_clientId_idx" ON "SalaryAdvance"("clientId");

-- CreateIndex
CREATE INDEX "SalaryAdvance_status_idx" ON "SalaryAdvance"("status");

-- CreateIndex
CREATE INDEX "SalaryAdvance_advancedAt_idx" ON "SalaryAdvance"("advancedAt");

-- CreateIndex
CREATE INDEX "SalaryAdvance_sourceUpdatedAt_idx" ON "SalaryAdvance"("sourceUpdatedAt");

-- CreateIndex
CREATE INDEX "SalaryAdvance_sourceDeletedAt_idx" ON "SalaryAdvance"("sourceDeletedAt");

-- CreateIndex
CREATE INDEX "SalaryAdvance_importBatchId_idx" ON "SalaryAdvance"("importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsRoute_reportKey_key" ON "AnalyticsRoute"("reportKey");

-- CreateIndex
CREATE INDEX "AnalyticsRoute_executionMode_enabled_idx" ON "AnalyticsRoute"("executionMode", "enabled");

-- CreateIndex
CREATE INDEX "SyncLog_startedAt_idx" ON "SyncLog"("startedAt");

-- CreateIndex
CREATE INDEX "MLOpsEvent_modelKey_createdAt_idx" ON "MLOpsEvent"("modelKey", "createdAt");

-- CreateIndex
CREATE INDEX "MLOpsEvent_employerId_period_idx" ON "MLOpsEvent"("employerId", "period");

-- CreateIndex
CREATE INDEX "MLOpsEvent_eventType_createdAt_idx" ON "MLOpsEvent"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "MLOpsModel_modelKey_status_idx" ON "MLOpsModel"("modelKey", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MLOpsModel_modelKey_version_key" ON "MLOpsModel"("modelKey", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_name_key" ON "Partner"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Partner_slug_key" ON "Partner"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_setupToken_key" ON "User"("setupToken");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_idx" ON "AnalyticsEvent"("userId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_type_idx" ON "AnalyticsEvent"("type");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

-- CreateIndex
CREATE INDEX "UserEmployer_userId_idx" ON "UserEmployer"("userId");

-- CreateIndex
CREATE INDEX "UserEmployer_employerId_idx" ON "UserEmployer"("employerId");

-- CreateIndex
CREATE UNIQUE INDEX "UserEmployer_userId_employerId_key" ON "UserEmployer"("userId", "employerId");

-- CreateIndex
CREATE INDEX "UserSectionAccess_userId_idx" ON "UserSectionAccess"("userId");

-- CreateIndex
CREATE INDEX "UserSectionAccess_sectionKey_idx" ON "UserSectionAccess"("sectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "UserSectionAccess_userId_sectionKey_key" ON "UserSectionAccess"("userId", "sectionKey");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_token_idx" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_createdAt_idx" ON "Session"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Session_userId_lastSeenAt_idx" ON "Session"("userId", "lastSeenAt");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "ReportSchedule_userId_idx" ON "ReportSchedule"("userId");

-- CreateIndex
CREATE INDEX "ReportSchedule_employerId_idx" ON "ReportSchedule"("employerId");

-- CreateIndex
CREATE INDEX "ReportSchedule_active_nextRunAt_idx" ON "ReportSchedule"("active", "nextRunAt");

-- CreateIndex
CREATE INDEX "ReportDeliveryLog_scheduleId_idx" ON "ReportDeliveryLog"("scheduleId");

-- CreateIndex
CREATE INDEX "ReportDeliveryLog_sentAt_idx" ON "ReportDeliveryLog"("sentAt");

-- CreateIndex
CREATE INDEX "ReportDeliveryLog_status_idx" ON "ReportDeliveryLog"("status");

-- CreateIndex
CREATE INDEX "ImportBatch_reportKey_idx" ON "ImportBatch"("reportKey");

-- CreateIndex
CREATE INDEX "ImportBatch_employerRef_reportKey_status_committedAt_idx" ON "ImportBatch"("employerRef", "reportKey", "status", "committedAt");

-- CreateIndex
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");

-- CreateIndex
CREATE INDEX "ImportBatch_uploadedAt_idx" ON "ImportBatch"("uploadedAt");

-- CreateIndex
CREATE INDEX "ImportBatchRow_batchId_rowIndex_idx" ON "ImportBatchRow"("batchId", "rowIndex");

-- CreateIndex
CREATE INDEX "ScoreWeight_employerId_driver_effectiveFrom_idx" ON "ScoreWeight"("employerId", "driver", "effectiveFrom");

-- CreateIndex
CREATE INDEX "AdminAuditLog_createdAt_idx" ON "AdminAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_actorEmail_createdAt_idx" ON "AdminAuditLog"("actorEmail", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_riskLevel_flagged_createdAt_idx" ON "AdminAuditLog"("riskLevel", "flagged", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_createdAt_idx" ON "LoginEvent"("createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_email_createdAt_idx" ON "LoginEvent"("email", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_userId_createdAt_idx" ON "LoginEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_success_createdAt_idx" ON "LoginEvent"("success", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_ipAddress_createdAt_idx" ON "LoginEvent"("ipAddress", "createdAt");

-- CreateIndex
CREATE INDEX "LoginEvent_deviceKey_createdAt_idx" ON "LoginEvent"("deviceKey", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAlert_status_severity_createdAt_idx" ON "SecurityAlert"("status", "severity", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAlert_userId_createdAt_idx" ON "SecurityAlert"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityAlert_actorEmail_createdAt_idx" ON "SecurityAlert"("actorEmail", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IpGeolocationCache_ipHash_key" ON "IpGeolocationCache"("ipHash");

-- CreateIndex
CREATE INDEX "IpGeolocationCache_expiresAt_idx" ON "IpGeolocationCache"("expiresAt");

-- CreateIndex
CREATE INDEX "DataAccessEvent_createdAt_idx" ON "DataAccessEvent"("createdAt");

-- CreateIndex
CREATE INDEX "DataAccessEvent_userId_createdAt_idx" ON "DataAccessEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "DataAccessEvent_route_createdAt_idx" ON "DataAccessEvent"("route", "createdAt");

-- CreateIndex
CREATE INDEX "DataAccessEvent_actorEmail_createdAt_idx" ON "DataAccessEvent"("actorEmail", "createdAt");

-- CreateIndex
CREATE INDEX "ProcessingActivity_active_idx" ON "ProcessingActivity"("active");

-- CreateIndex
CREATE INDEX "ProcessingActivity_partyRole_idx" ON "ProcessingActivity"("partyRole");

-- CreateIndex
CREATE INDEX "ProcessingActivity_crossBorder_idx" ON "ProcessingActivity"("crossBorder");

-- CreateIndex
CREATE INDEX "ProcessingActivity_nextReviewAt_idx" ON "ProcessingActivity"("nextReviewAt");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_status_dueAt_idx" ON "DataSubjectRequest"("status", "dueAt");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_requesterEmail_createdAt_idx" ON "DataSubjectRequest"("requesterEmail", "createdAt");

-- CreateIndex
CREATE INDEX "DataSubjectRequest_employerId_createdAt_idx" ON "DataSubjectRequest"("employerId", "createdAt");

-- CreateIndex
CREATE INDEX "ComplianceVendor_approved_crossBorder_idx" ON "ComplianceVendor"("approved", "crossBorder");

-- CreateIndex
CREATE INDEX "ComplianceVendor_nextReviewAt_idx" ON "ComplianceVendor"("nextReviewAt");

-- CreateIndex
CREATE UNIQUE INDEX "RetentionPolicy_dataClass_key" ON "RetentionPolicy"("dataClass");

-- CreateIndex
CREATE INDEX "RetentionPolicy_active_nextReviewAt_idx" ON "RetentionPolicy"("active", "nextReviewAt");

-- CreateIndex
CREATE INDEX "SecurityIncident_status_severity_discoveredAt_idx" ON "SecurityIncident"("status", "severity", "discoveredAt");

-- CreateIndex
CREATE INDEX "SecurityIncident_regulatorNotifiedAt_idx" ON "SecurityIncident"("regulatorNotifiedAt");

-- CreateIndex
CREATE INDEX "AchievableTarget_employerId_driver_effectiveFrom_idx" ON "AchievableTarget"("employerId", "driver", "effectiveFrom");

-- AddForeignKey
ALTER TABLE "Employer" ADD CONSTRAINT "Employer_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerHeadcountSnapshot" ADD CONSTRAINT "EmployerHeadcountSnapshot_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Site" ADD CONSTRAINT "Site_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Employee" ADD CONSTRAINT "Employee_siteId_fkey" FOREIGN KEY ("siteId") REFERENCES "Site"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeVersion" ADD CONSTRAINT "EmployeeVersion_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformUser" ADD CONSTRAINT "PlatformUser_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyEvent" ADD CONSTRAINT "JourneyEvent_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtAccount" ADD CONSTRAINT "DebtAccount_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtAccount" ADD CONSTRAINT "DebtAccount_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DebtAccountVersion" ADD CONSTRAINT "DebtAccountVersion_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "DebtAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurancePolicy" ADD CONSTRAINT "InsurancePolicy_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InsurancePolicyVersion" ADD CONSTRAINT "InsurancePolicyVersion_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "InsurancePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatSession" ADD CONSTRAINT "ChatSession_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_platformUserId_fkey" FOREIGN KEY ("platformUserId") REFERENCES "PlatformUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreSnapshot" ADD CONSTRAINT "ScoreSnapshot_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardCohortCache" ADD CONSTRAINT "DashboardCohortCache_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEmployer" ADD CONSTRAINT "UserEmployer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserEmployer" ADD CONSTRAINT "UserEmployer_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSectionAccess" ADD CONSTRAINT "UserSectionAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSectionAccess" ADD CONSTRAINT "UserSectionAccess_sectionKey_fkey" FOREIGN KEY ("sectionKey") REFERENCES "DashboardSection"("key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportSchedule" ADD CONSTRAINT "ReportSchedule_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportDeliveryLog" ADD CONSTRAINT "ReportDeliveryLog_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ReportSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatchRow" ADD CONSTRAINT "ImportBatchRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScoreWeight" ADD CONSTRAINT "ScoreWeight_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoginEvent" ADD CONSTRAINT "LoginEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityAlert" ADD CONSTRAINT "SecurityAlert_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataAccessEvent" ADD CONSTRAINT "DataAccessEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DataSubjectRequest" ADD CONSTRAINT "DataSubjectRequest_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievableTarget" ADD CONSTRAINT "AchievableTarget_employerId_fkey" FOREIGN KEY ("employerId") REFERENCES "Employer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

