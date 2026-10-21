// Database-backed scoring delta rehearsal against a guarded, synthetic Neon TESTING fixture.
// Runs real snapshotEmployer() twice and proves a canonical record change alters
// ScoreSnapshot and dashboard GET data. Restores the fixture in finally.
// Does NOT claim queue jobs, publish manifests, use external storage, or deploy.
import assert from "node:assert/strict";
import { prisma, snapshotEmployer, getDashboardPayload } from "../src/services/snapshotBuilder.js";
import { partitionsFromCanonicalSourceRows } from "../src/services/semanticSourceChangePlanner.js";
import { LOAD_ORDER } from "../src/services/reportFormats.js";

const databaseName="newchanges_testing_20261017";
const employerId="__synthetic_semantic_e2e_20261019__";
const generationId="__synthetic_semantic_generation_20261019__";
const journeyId=employerId+"-journey";
const period="2026-10";
const baseSavingsCents=10000;
const changedSavingsCents=30000;

function guard() {
  if(process.env.SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY")
    throw new Error("Explicit SEMANTIC_SYNTHETIC_E2E_APPROVED=YES_TEST_ONLY is required");
  const raw=process.env.DATABASE_URL??"";
  let url:URL;
  try { url=new URL(raw); } catch { throw new Error("Isolated Testing DATABASE_URL is required"); }
  if(!["postgres:","postgresql:"].includes(url.protocol) ||
     !url.hostname.endsWith(".neon.tech") ||
     url.pathname!=="/"+databaseName ||
     url.searchParams.get("sslmode")!=="require")
    throw new Error("Refusing anything except isolated Neon newchanges_testing_20261017 with sslmode=require");
  if(process.env.ENABLE_SEMANTIC_SHADOW_WORKER==="true" ||
     process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH==="true")
    throw new Error("Disable live semantic workers and publication during score-delta rehearsal");
}

async function readScore() {
  const score=await prisma.scoreSnapshot.findUnique({
    where:{employerId_period:{employerId,period}},
    select:{optimiseScore:true,payloadVersion:true,payload:true},
  });
  assert(score && score.payloadVersion>=4, "A complete v4 score snapshot must be persisted");
  assert.equal((score.payload as any)?.wellness?.score,score.optimiseScore);
  const dashboard=await getDashboardPayload(employerId,{period});
  assert.equal(dashboard?.wellness?.score,score.optimiseScore,
    "Dashboard must read the same updated score as PostgreSQL");
  return score.optimiseScore;
}

async function run() {
  guard();
  const started=Date.now();
  let changed=false;
  let originalUpdatedAt:Date|null=null;
  try {
    const actual=await prisma.$queryRaw<Array<{name:string}>>`SELECT current_database() AS name`;
    assert.equal(actual[0]?.name,databaseName,"Wrong database identity");
    const employer=await prisma.employer.findUnique({where:{id:employerId},select:{name:true}});
    assert(employer?.name?.startsWith("SYNTHETIC QA ONLY"),"Fixture employer missing or not synthetic");
    const generation=await prisma.sourceGeneration.findUnique({
      where:{id:generationId},include:{cursors:{select:{reportKey:true,reconciledAt:true}}},
    });
    assert(generation,"Synthetic source generation missing");
    assert.equal((generation.validation as any)?.testingOnly,true,"Testing-only generation required");
    assert.equal(generation?.state,"ACTIVE");
    assert.deepEqual(
      generation.cursors.filter(c=>c.reconciledAt).map(c=>c.reportKey).sort(),
      [...LOAD_ORDER].sort(),"Ten synthetic reconciliation cursors required");
    const journey=await prisma.journey.findUnique({where:{id:journeyId},select:{monthlySavingCents:true,sourceUpdatedAt:true}});
    assert.equal(journey?.monthlySavingCents,baseSavingsCents,
      "Fixture already modified; do not overwrite unexpected data");
    originalUpdatedAt=journey!.sourceUpdatedAt;

    const baseline=await snapshotEmployer(employerId,period);
    assert(baseline.persisted && baseline.scoreReady,"Synthetic baseline must produce a complete score");
    const before=await readScore();
    const edited=await prisma.journey.updateMany({
      where:{id:journeyId,monthlySavingCents:baseSavingsCents},
      data:{monthlySavingCents:changedSavingsCents,sourceUpdatedAt:new Date()},
    });
    assert.equal(edited.count,1,"Only the synthetic journey may change");
    changed=true;

    const affected=partitionsFromCanonicalSourceRows("journeys",[{
      employer_ref:employerId,started_at:"2026-10-01",
      source_updated_at:new Date().toISOString(),
    }]);
    assert.deepEqual(affected,[{employerId,period,feeds:["journeys"],deleted:false}]);
    const refreshed=await snapshotEmployer(employerId,period);
    assert(refreshed.persisted && refreshed.scoreReady,"Changed score must be persisted");
    const after=await readScore();
    assert.notEqual(after,before,"Canonical source change must actually change calculated wellness score");
    console.log(JSON.stringify({
      test:"isolated-Neon-canonical-score-delta",database:databaseName,
      employer:employerId,period,baselineScore:before,changedScore:after,
      scoreChanged:true,calcAndReadMs:Date.now()-started,
      publicationTested:false,browserTested:false,
    }));
  } finally {
    try {
      if(changed) {
        const reverted=await prisma.journey.updateMany({
          where:{id:journeyId,monthlySavingCents:changedSavingsCents},
          data:{monthlySavingCents:baseSavingsCents,sourceUpdatedAt:originalUpdatedAt!},
        });
        if(reverted.count!==1) throw new Error("Synthetic fixture restore failed; manual Testing review required");
        const restored=await snapshotEmployer(employerId,period);
        if(!restored.persisted || !restored.scoreReady)
          throw new Error("Synthetic fixture baseline score could not be restored");
        console.log("Synthetic Testing journey and baseline score restored");
      }
    } finally {
      await prisma.$disconnect();
    }
  }
}
run().catch(error=>{console.error("Isolated semantic score-delta failed:",error?.message||String(error));process.exitCode=1;});
