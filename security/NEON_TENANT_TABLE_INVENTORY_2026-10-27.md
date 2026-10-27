# NewChanges 57-table tenant boundary inventory (read-only snapshot: 27 October 2026)

**Status: UNPROTECTED.** This document is a schema catalog and migration-design input, not an authorization policy or proof of absence of exploitation. Captured read-only from Neon primary `newchanges-primary-pg18` public schema. No record contents were accessed or changed.

- Public ordinary tables: **57**
- RLS enabled: **0**; FORCE RLS: **0**
- Candidate classifications: Direct employer key 18; Review: no obvious tenant key 25; Identity/partner scoped 6; Indirect via employee 7; Tenant root 1.
- `newchanges_owner` currently bypasses RLS. An effective runtime boundary must use a non-bypass, non-owner role.

**Classification is heuristic.** A column named `employerId` or an FK to `Employee` does not establish a secure policy. The “Review” group is not automatically safe, public or global. A table can contain employee data without a direct tenant identifier. Verify every row of this inventory against Prisma models, application queries and an approved processing map.

| Table | Candidate scope | Scope-like columns | FK target tables |
|---|---|---|---|
| `AchievableTarget` | Direct employer key | `employerId` | `Employer` |
| `AdminAuditLog` | Review: no obvious tenant key | — | — |
| `AnalyticsEvent` | Identity/partner scoped | `partnerId`, `userId` | `User` |
| `AnalyticsRoute` | Review: no obvious tenant key | — | — |
| `BrandLearningState` | Review: no obvious tenant key | — | — |
| `ChatSession` | Direct employer key | `employeeId`, `employerId`, `importBatchId` | `Employee`, `Employer` |
| `ComplianceVendor` | Review: no obvious tenant key | — | — |
| `DashboardCohortCache` | Direct employer key | `employerId` | `Employer` |
| `DashboardSection` | Review: no obvious tenant key | — | — |
| `DataAccessEvent` | Direct employer key | `employerId`, `userId` | `User` |
| `DataSubjectRequest` | Direct employer key | `employerId` | `Employer` |
| `DebtAccount` | Indirect via employee | `importBatchId`, `platformUserId` | `Journey`, `PlatformUser` |
| `DebtAccountVersion` | Review: no obvious tenant key | `importBatchId` | `DebtAccount` |
| `Employee` | Direct employer key | `employerId`, `importBatchId`, `siteId` | `Employer`, `Site` |
| `EmployeeVersion` | Indirect via employee | `employeeId`, `importBatchId` | `Employee` |
| `Employer` | Tenant root | `partnerId` | `Partner` |
| `EmployerHeadcountSnapshot` | Direct employer key | `employerId`, `importBatchId` | `Employer` |
| `ImportBatch` | Review: no obvious tenant key | — | — |
| `ImportBatchRow` | Review: no obvious tenant key | — | `ImportBatch` |
| `InsurancePolicy` | Indirect via employee | `importBatchId`, `platformUserId` | `PlatformUser` |
| `InsurancePolicyVersion` | Review: no obvious tenant key | `importBatchId` | `InsurancePolicy` |
| `IntegrationConfig` | Review: no obvious tenant key | — | — |
| `IntegrationCursor` | Review: no obvious tenant key | — | — |
| `IpGeolocationCache` | Review: no obvious tenant key | — | — |
| `Journey` | Indirect via employee | `importBatchId`, `platformUserId` | `PlatformUser` |
| `JourneyEvent` | Review: no obvious tenant key | — | `Journey` |
| `LoginEvent` | Identity/partner scoped | `userId` | `User` |
| `MLOpsEvent` | Direct employer key | `employerId` | — |
| `MLOpsModel` | Review: no obvious tenant key | — | — |
| `Partner` | Review: no obvious tenant key | — | — |
| `PlatformUser` | Indirect via employee | `employeeId`, `importBatchId` | `Employee` |
| `ProcessingActivity` | Review: no obvious tenant key | — | — |
| `Rating` | Indirect via employee | `importBatchId`, `platformUserId` | `PlatformUser` |
| `Referral` | Indirect via employee | `importBatchId`, `platformUserId` | `PlatformUser` |
| `ReportDeliveryLog` | Review: no obvious tenant key | — | `ReportSchedule` |
| `ReportSchedule` | Direct employer key | `employerId`, `userId` | `Employer`, `User` |
| `RetentionPolicy` | Review: no obvious tenant key | — | — |
| `SalaryAdvance` | Direct employer key | `employeeId`, `employerId`, `importBatchId` | `Employee`, `Employer` |
| `ScoreSnapshot` | Direct employer key | `employerId` | `Employer` |
| `ScoreWeight` | Direct employer key | `employerId` | `Employer` |
| `SecurityAlert` | Identity/partner scoped | `userId` | `User` |
| `SecurityIncident` | Review: no obvious tenant key | — | — |
| `SemanticPublicationAudit` | Direct employer key | `employerId` | — |
| `SemanticPublicationPointer` | Direct employer key | `employerId` | — |
| `SemanticRefreshJob` | Direct employer key | `employerId` | — |
| `SemanticSnapshotManifest` | Direct employer key | `employerId` | `SourceGeneration` |
| `Session` | Identity/partner scoped | `userId` | `User` |
| `Site` | Direct employer key | `employerId` | `Employer` |
| `SourceActivationAudit` | Review: no obvious tenant key | — | — |
| `SourceConnectionVault` | Review: no obvious tenant key | — | `SourceGeneration` |
| `SourceGeneration` | Review: no obvious tenant key | — | — |
| `SourceGenerationCursor` | Review: no obvious tenant key | — | `SourceGeneration` |
| `SyncLog` | Review: no obvious tenant key | — | — |
| `SystemEmailConfig` | Review: no obvious tenant key | — | — |
| `User` | Identity/partner scoped | `partnerId` | `Partner` |
| `UserEmployer` | Direct employer key | `employerId`, `userId` | `Employer`, `User` |
| `UserSectionAccess` | Identity/partner scoped | `userId` | `DashboardSection`, `User` |

## Mandatory mapping and release steps

1. Confirm scope classification for all 57 models. Review indirect relationships and tables without explicit `employerId` such as child event/version/audit tables. Document system-global table read/write policy separately.
2. Use least-privileged non-owner runtime and separate migrator role; never run the production app as `newchanges_owner` with `BYPASSRLS`.
3. Set trusted tenant context inside a **single transaction** at the server, with explicit pooled-connection clean-up. Never derive tenant identity directly from an HTTP header, parameter or unsafe database GUC exposed to the client.
4. For each scoped table, design `SELECT/INSERT/UPDATE/DELETE` policies with restrictive `USING` and `WITH CHECK`. Test cross-tenant foreign-key writes and joins; no visibility or mutation without validated context.
5. Treat `Employer` as a tenant root; separately model administrators, partners, background jobs, imports, sources and data subject requests without unlimited access to sensitive records.
6. Validate the policy migration and app access on an isolated Neon branch with synthetic and negative cross-tenant fixtures, transaction pooling, reports and authenticated API routes. Record rollback and performance plan.
7. Only after acceptance and restore tests, switch production runtime to new least-privileged credentials, deploy per-table policies, and revoke the prior credential as tracked in #204.

This inventory does **not** apply a database mutation or close the security blocker #199.
