// Explicit Testing-only durable queue integration; no storage or publication.
// Requires a previously seeded synthetic fixture. Cleans up its own job.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/services/snapshotBuilder.js";
import { enqueueSemanticRefresh, claimSemanticRefresh, finishSemanticRefresh } from "../src/services/semanticRefreshQueue.js";

const expectedDb="newchanges_testing_20261017";
const employerId="__synthetic_semantic_e2e_20261019__";
const generationId="__synthetic_semantic_generation_20261019__";
const period="2026-10";

function guard() {
  if(process.env.SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY")
    throw new Error("Testing-only explicit approval required");
  let url:URL;
  try {url=new URL(process.env.DATABASE_URL??"");}
  catch {throw new Error("Isolated Neon Testing DATABASE_URL required");}
  if(!["postgres:","postgresql:"].includes(url.protocol) ||
    !url.hostname.endsWith(".neon.tech") ||
    url.pathname!=="/"+expectedDb ||
    url.searchParams.get("sslmode")!=="require")
    throw new Error("Refusing queue rehearsal outside isolated Neon Testing database");
  if(process.env.ENABLE_SEMANTIC_SHADOW_WORKER==="true" ||
     process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH==="true")
    throw new Error("Background workers and publication must be disabled during isolated queue rehearsal");
}

async function main() {
  guard();
  let ownJobId:string|null=null;
  try {
    const identity=await prisma.$queryRaw<Array<{name:string}>>`SELECT current_database() AS name`;
    assert.equal(identity[0]?.name,expectedDb,"Database identity mismatch");
    const gen=await prisma.sourceGeneration.findUnique({where:{id:generationId},select:{validation:true,state:true}});
    assert(gen && gen.state==="ACTIVE" && (gen.validation as any)?.testingOnly===true,
      "Isolated synthetic generation required");
    const employer=await prisma.employer.findUnique({where:{id:employerId},select:{name:true}});
    assert(employer?.name?.startsWith("SYNTHETIC QA ONLY"),"Synthetic employer required");
    const busy=await prisma.semanticRefreshJob.count({where:{status:{in:["PENDING","RUNNING"]}}});
    assert.equal(busy,0,"Queue has pending work; refusing to claim unrelated jobs");

    const watermark=new Date();
    const part={employerId,period,feeds:["journeys"],deleted:false};
    const first=await enqueueSemanticRefresh(generationId,watermark,[part]);
    assert.equal(first.queued,1,"Synthetic refresh job must be inserted");
    const created=await prisma.semanticRefreshJob.findFirst({
      where:{generationId,employerId,period,sourceWatermark:watermark,status:"PENDING"},
      orderBy:{createdAt:"desc"},select:{id:true},
    });
    assert(created,"Cannot identify inserted synthetic refresh job");
    ownJobId=created.id;

    const again=await enqueueSemanticRefresh(generationId,watermark,[part]);
    assert.equal(again.queued,0,"Same idempotency key must not queue duplicate work");
    assert.equal(again.deduplicated,1);

    const workerId="synthetic_"+randomUUID().replaceAll("-","");
    const claimed=await claimSemanticRefresh(workerId,180,{generationId,employerId});
    assert.equal(claimed?.id,ownJobId,"Worker must claim only the isolated synthetic job");
    await finishSemanticRefresh(ownJobId!,workerId,true);
    const finished=await prisma.semanticRefreshJob.findUnique({
      where:{id:ownJobId},select:{status:true,attempts:true,workerId:true},
    });
    assert.equal(finished?.status,"COMPLETED");
    assert.equal(finished?.attempts,1);
    assert.equal(finished?.workerId,null);
    console.log(JSON.stringify({test:"isolated-Neon-durable-queue",database:expectedDb,
      queued:first.queued,deduplicated:again.deduplicated,claimed:true,completed:true,
      publicationTested:false,productionModified:false}));
  } finally {
    try {
      if(ownJobId) {
        const removed=await prisma.semanticRefreshJob.deleteMany({
          where:{id:ownJobId,generationId,employerId},
        });
        if(removed.count!==1)
          throw new Error("Synthetic queue job cleanup failed; review isolated Testing queue");
        console.log("Synthetic Testing queue job removed");
      }
    } finally {
      await prisma.$disconnect();
    }
  }
}
main().catch(error=>{console.error("Isolated semantic queue rehearsal failed:",error?.message||String(error));process.exitCode=1;});
