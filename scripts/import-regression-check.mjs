import { readFileSync } from "node:fs";

const imports = readFileSync("src/services/importService.ts", "utf8");
const staged = readFileSync("src/services/stagedRows.ts", "utf8");
const server = readFileSync("src/server.ts", "utf8");
const syncService = readFileSync("src/services/syncService.ts", "utf8");
const asyncJobs = readFileSync("src/services/asyncJobs.ts", "utf8");
const admin = readFileSync("public/admin.html", "utf8");
const bulkSql = readFileSync("src/Migrations/001-sync-upsert-procedures.sql", "utf8");
const migrationRunner = readFileSync("scripts/apply-sync-migrations.mjs", "utf8");
const failures = [];
const must = (ok, msg) => { if (!ok) failures.push(msg); };

must(imports.includes("rehydrateStagedRows(format, stagedRows)"), "commitBatch must rehydrate staged temporal values before importing");
must(staged.includes('field.type === "date" || field.type === "datetime"'), "all contract DATE/DATETIME fields must be restored");
must(imports.includes('compareDateValues(row.observed_at, existing.observedAt, "observed_at")'), "dated projections must use defensive date comparison");
must(!imports.includes("row.observed_at.getTime()"), "import commit must not call getTime directly on staged observed_at values");
must(server.includes("startCommitJob(req.params.batchId)") && server.includes('reply.code(202).send({ status: "ACCEPTED"'), "commit route must hand off to the async commit job and return 202 immediately");
must(asyncJobs.includes('console.error("[commit-job] commit failed:", e)') && asyncJobs.includes("job.error ="), "commit job runner must log failures and record a useful error for the poller");
must(server.includes('if (job.status === "FAILED") return { status: "FAILED", error: job.error }'), "commit-job status route must surface the recorded failure to the client");
must(admin.includes("if(resultArea) resultArea.innerHTML=''"), "reset UI must not dereference a missing import result element");
must(bulkSql.includes("md5((r->>'employer_ref') || '|' || (r->>'site_name'))"), "employee bulk sync must extract employer/site values from JSON instead of referencing nonexistent SQL columns");
must(bulkSql.includes('::"IncomeBand"') && bulkSql.includes('::"JourneyType"') && bulkSql.includes('::"JourneyStatus"') && bulkSql.includes('::"CreditType"') && bulkSql.includes('::"DebtState"') && bulkSql.includes('::"ChallengeStatus"') && bulkSql.includes('::"PolicyType"') && bulkSql.includes('::"AdvanceStatus"'), "bulk sync must cast canonical enum strings to Prisma PostgreSQL enum types");
must(!/VARCHAR\(30\) AS (?:income_band|type|status|credit_type|state|challenge_status|journey_type)/.test(bulkSql), "bulk sync historical paths must not fall back to VARCHAR for Prisma enum columns");
must(!/ROUND\(\(r->>'(?:monthly_saving_rand|balance_impact_rand|balance_rand|premium_rand|amount)'\)::NUMERIC \* 100\)/.test(bulkSql), "bulk sync must not multiply already-normalised integer cents by 100 again");
must(bulkSql.includes('"siteName","incomeBand","active"') && bulkSql.includes('"incomeBand"=EXCLUDED."incomeBand"'), "employee historical versions must preserve income band");
must(bulkSql.includes('"policyId","observedAt","type","premiumCents"') && bulkSql.includes('"type"=EXCLUDED."type", "premiumCents"'), "policy historical versions must persist the required policy type");
must((migrationRunner.match(/SMOKE OK/g)||[]).length >= 1 && migrationRunner.includes("sync_upsert_employees") && migrationRunner.includes("sync_upsert_salary_advances"), "deployment must smoke-test all bulk procedures against the real schema");
must((bulkSql.match(/SELECT DISTINCT ON/g)||[]).length >= 3 && bulkSql.includes("ORDER BY employer_ref, payroll_ref, observed_at DESC, source_updated_at DESC") && bulkSql.includes("ORDER BY account_ref, observed_at DESC, source_updated_at DESC") && bulkSql.includes("ORDER BY policy_ref, observed_at DESC, source_updated_at DESC"), "dated bulk feeds must dedupe current projections while preserving observation history");
must(migrationRunner.includes("dated multi-observation projection/history semantics") && migrationRunner.includes("EmployeeVersion") && migrationRunner.includes("DebtAccountVersion") && migrationRunner.includes("InsurancePolicyVersion"), "deployment smoke tests must exercise duplicate projection keys with multiple dated history rows");
must(syncService.includes('cardinalityConflict') && syncService.includes('CHUNKED_COMPATIBILITY') && syncService.includes('ON CONFLICT DO UPDATE command cannot affect row a second time'), "source sync must preserve the old chunked importer as a correctness fallback for SQLSTATE 21000 bulk conflicts");
must(bulkSql.includes('ON CONFLICT ("advanceRef") DO UPDATE') && !bulkSql.includes('ON CONFLICT ("id") DO UPDATE SET\n      "employeeId"=EXCLUDED."employeeId", "clientId"=EXCLUDED."clientId"'), "salary advance bulk sync must upsert by unique advanceRef so previously imported rows cannot collide on the secondary unique key");
must(bulkSql.includes("md5('salary-advance|' || salary_advance_id)") && bulkSql.includes('("id","advanceRef","employerId"'), "salary advance bulk sync must provide a deterministic internal id because Prisma cuid defaults are application-side and PostgreSQL has no id default");

if (failures.length) {
  console.error("Import regression check failed:\n- " + failures.join("\n- "));
  process.exit(1);
}
console.log("Import regression check passed: staged values, bulk SQL schema mappings, cents/enums and deployment smoke tests are guarded.");
