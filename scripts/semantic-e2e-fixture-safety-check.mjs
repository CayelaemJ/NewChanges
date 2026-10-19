import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const seed=readFileSync("scripts/fixtures/semantic-neon-testing-20261019.sql","utf8");
const runner=readFileSync("scripts/semantic-testing-score-delta.ts","utf8");
const preflight=readFileSync("scripts/semantic-e2e-preflight.mjs","utf8");

assert(seed.includes("current_database() <> 'newchanges_testing_20261017'"),
  "Fixture must enforce exact isolated Neon database identity");
assert(!/\\b(?:DELETE\\s+FROM|TRUNCATE|DROP\\s+TABLE|UPDATE\\s+)/i.test(seed),
  "Fixture must remain insert-only; never delete or overwrite data");
for(const table of ["Employer","EmployerHeadcountSnapshot","Employee","PlatformUser",
  "Journey","DebtAccount","InsurancePolicy","Rating","Referral","SalaryAdvance",
  "AchievableTarget","SourceGeneration","SourceGenerationCursor"])
  assert(seed.includes('INSERT INTO "'+table+'"'),"Missing synthetic table: "+table);
assert.equal((seed.match(/INSERT INTO "SourceGenerationCursor"/g)||[]).length,10,
  "Fixture requires precisely ten synthetic feed reconciliation cursors");
assert(runner.includes('SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY"'),
  "Score-delta rehearsal must require explicit opt-in");
assert(runner.includes('url.pathname!=="/"+databaseName'),
  "Score-delta rehearsal must fail closed on the database name");
assert(runner.includes("await snapshotEmployer(employerId,period)"),
  "Score-delta rehearsal must run the actual application score builder");
assert(runner.includes("assert.notEqual(after,before"),
  "Score-delta rehearsal must demonstrate a changed score");
assert(runner.includes("if(changed) {") && runner.includes("Synthetic Testing journey and baseline score restored"),
  "Rehearsal must restore its own source fixture and persisted baseline");
assert(!runner.includes("stageAndPublishSemanticObject("),
  "Synthetic-only rehearsal must not publish manifests without durable storage");
assert(preflight.includes("BEGIN READ ONLY"),"Preflight must not write to database");
console.log("Isolated Neon synthetic fixture and score-delta runner safety assertions passed");
