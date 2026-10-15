// Read-only preflight for replacing a completely different canonical dataset.
// No deletes, writes, imports, source credential reads or connection changes.
import { prisma } from "./snapshotBuilder.js";
import { LOAD_ORDER } from "./reportFormats.js";

export async function previewDatasetReplacement() {
  const [employers,employees,sites,versions,platformUsers,journeys,journeyEvents,
    debtAccounts,debtVersions,policies,policyVersions,ratings,referrals,salaryAdvances,
    headcounts,scores,cohorts,users,userEmployers,reportSchedules,
    batches,cursors,sourceGenerations,semanticJobs,semanticPointers] = await Promise.all([
      prisma.employer.count(),prisma.employee.count(),prisma.site.count(),
      prisma.employeeVersion.count(),prisma.platformUser.count(),prisma.journey.count(),
      prisma.journeyEvent.count(),prisma.debtAccount.count(),prisma.debtAccountVersion.count(),
      prisma.insurancePolicy.count(),prisma.insurancePolicyVersion.count(),prisma.rating.count(),
      prisma.referral.count(),prisma.salaryAdvance.count(),prisma.employerHeadcountSnapshot.count(),
      prisma.scoreSnapshot.count(),prisma.dashboardCohortCache.count(),prisma.user.count(),
      prisma.userEmployer.count(),prisma.reportSchedule.count(),prisma.importBatch.count(),
      prisma.integrationCursor.count({where:{reportKey:{in:LOAD_ORDER}}}),
      prisma.sourceGeneration.count(),prisma.semanticRefreshJob.count(),
      prisma.semanticPublicationPointer.count(),
    ]);
  return {
    mode:"PREVIEW_ONLY" as const, executable:false,
    note:"This preview does not delete records or validate a replacement connection. Dataset replacement is not implemented.",
    reportingRows:{employers,employees,sites,versions,platformUsers,journeys,journeyEvents,
      debtAccounts,debtVersions,policies,policyVersions,ratings,referrals,salaryAdvances,
      headcounts,scores,cohorts,batches,cursors,sourceGenerations,semanticJobs,semanticPointers},
    identitiesToPreserve:{users,userEmployers,reportSchedules},
    blockingChecks:[
      "Preserve existing users, credentials, access grants, partner configuration and audit trails",
      "Map or revoke user-employer and report-schedule references before replacing employer identifiers",
      "Validate a different SQL source and all ten canonical feeds without mutating the live connection",
      "Suspend ingestion; establish a verified Neon rollback branch and test restoration",
      "Prove bulk import, cutover, snapshot parity and rollback in disposable Playground",
    ],
  };
}
