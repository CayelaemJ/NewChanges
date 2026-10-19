// Manual opt-in Neon Testing integration: canonical row -> persisted score ->
// independently read-back-verified in-memory HTTPS object -> publisher CAS ->
// canary read -> durable version feed -> audited rollback -> fixture restore.
// This is NOT a live HTTP/browser, external source or durable S3 acceptance test.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, snapshotEmployer, getDashboardPayload } from "../src/services/snapshotBuilder.js";
import { readPublishedSemanticPartition } from "../src/services/semanticCanaryRead.js";
import { stageAndPublishSemanticObject } from "../src/services/semanticObjectPipeline.js";
import { rollbackSemanticPublication } from "../src/services/semanticPublisher.js";
import { readSemanticPublicationChanges } from "../src/services/semanticPublicationFeed.js";
import { createSemanticStorageBroker } from "../src/services/semanticS3Broker.js";
import { LOAD_ORDER } from "../src/services/reportFormats.js";

const dbName="newchanges_testing_20261017";
const employerId="__synthetic_semantic_e2e_20261019__";
const generationId="__synthetic_semantic_generation_20261019__";
const period="2026-10";
const partitionKey="all";
const journeyId=employerId+"-journey";
const key={employerId,period,partitionKey};
const prefix="semantic/"+generationId+"/"+employerId+"/"+period+"/";
const envKeys=["ENABLE_SEMANTIC_OBJECT_PUBLISH","ENABLE_SEMANTIC_CANARY_READ",
  "SEMANTIC_S3_ENDPOINT","SEMANTIC_S3_BUCKET","SEMANTIC_S3_REGION",
  "SEMANTIC_S3_ACCESS_KEY_ID","SEMANTIC_S3_SECRET_ACCESS_KEY"];
const previousEnv=new Map(envKeys.map(k=>[k,process.env[k]]));
const previousFetch=globalThis.fetch;
const stored=new Map<string,Uint8Array>();
const ownedVersions:string[]=[];
let changed=false;
let originalUpdatedAt:Date|null=null;

function guard(){
  if(process.env.SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY")
    throw new Error("Explicit isolated Testing approval required");
  let url:URL;
  try{url=new URL(process.env.DATABASE_URL??"");}
  catch{throw new Error("An isolated Neon Testing DATABASE_URL is required");}
  if(!["postgres:","postgresql:"].includes(url.protocol) ||
     !url.hostname.endsWith(".neon.tech") || url.pathname!=="/"+dbName ||
     url.searchParams.get("sslmode")!=="require")
    throw new Error("Refusing canonical-to-canary integration outside isolated Neon Testing");
  if(["ENABLE_SEMANTIC_SHADOW_WORKER","ENABLE_SEMANTIC_OBJECT_PUBLISH",
      "ENABLE_SEMANTIC_DASHBOARD_SERVING"].some(k=>process.env[k]==="true"))
    throw new Error("Disable production workers, serving and object publishing for synthetic test");
}

function installMemoryBroker(){
  Object.assign(process.env,{
    SEMANTIC_S3_ENDPOINT:"https://testing-e2e.example.invalid",
    SEMANTIC_S3_BUCKET:"synthetic-testing",
    SEMANTIC_S3_REGION:"eu-west-1",
    SEMANTIC_S3_ACCESS_KEY_ID:"SYNTHETIC_MEMORY_ACCESS",
    SEMANTIC_S3_SECRET_ACCESS_KEY:"SYNTHETIC_MEMORY_SECRET",
    ENABLE_SEMANTIC_CANARY_READ:"true",
    ENABLE_SEMANTIC_OBJECT_PUBLISH:"false",
  });
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    const method=init?.method??"GET";
    if(url.hostname!=="testing-e2e.example.invalid" ||
       !url.pathname.startsWith("/synthetic-testing/"+prefix) ||
       url.searchParams.get("X-Amz-Algorithm")!=="AWS4-HMAC-SHA256" ||
       !/^[0-9a-f]{64}$/.test(url.searchParams.get("X-Amz-Signature")??""))
      throw new Error("Synthetic memory transport refused a non-Testing storage URL");
    if(method==="PUT"){
      stored.set(url.pathname,new Uint8Array(init?.body as Uint8Array));
      return new Response(null,{status:200});
    }
    if(method!=="GET")throw new Error("Synthetic memory transport permits only GET/PUT");
    const bytes=stored.get(url.pathname);
    return bytes?new Response(bytes,{status:200,headers:{"content-length":String(bytes.byteLength)}}):
      new Response(null,{status:404});
  };
}

async function publish(label:string,payload:unknown,previousManifestId:string|null,watermark:Date) {
  const version="synthetic-full-"+randomUUID();
  ownedVersions.push(version);
  const objectKey=prefix+version+".json";
  const content=Buffer.from(JSON.stringify({
    schemaVersion:"semantic-shadow-v1",calculationMode:"RECOMPUTED",
    generationId,employerId,period,partitionKey,
    asAt:watermark.toISOString(),payload,testingOnly:true,label,
  }),"utf8");
  const signed=await createSemanticStorageBroker().presign({objectKey,bytes:content.byteLength});
  process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH="true";
  try{
    return await stageAndPublishSemanticObject({
      generationId,employerId,period,partitionKey,version,objectKey,body:content,
      putUrl:signed.putUrl,getUrl:signed.getUrl,sourceWatermark:watermark,
      expectedPreviousManifestId:previousManifestId,actor:"isolated-full-e2e",
      reason:"synthetic canonical score-to-canary rehearsal",
    });
  }finally{process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH="false";}
}

async function completeScore(){
  const rebuilt=await snapshotEmployer(employerId,period);
  assert(rebuilt.persisted&&rebuilt.scoreReady,"All scoring drivers must be available");
  const payload=await getDashboardPayload(employerId,{period});
  assert(payload && Number.isFinite(Number(payload.wellness?.score)));
  const snapshot=await prisma.scoreSnapshot.findUnique({
    where:{employerId_period:{employerId,period}},select:{optimiseScore:true,payloadVersion:true},
  });
  assert(snapshot && snapshot.payloadVersion>=4);
  assert.equal(Number(payload.wellness.score),Number(snapshot.optimiseScore));
  return {payload,score:Number(snapshot.optimiseScore)};
}

async function run(){
  guard();
  try{
    const identity=await prisma.$queryRawUnsafe<Array<{name:string}>>("SELECT current_database() AS name");
    assert.equal(identity[0]?.name,dbName);
    const employer=await prisma.employer.findUnique({where:{id:employerId},select:{name:true}});
    assert(employer?.name.startsWith("SYNTHETIC QA ONLY"),"Synthetic fixture employer required");
    const generation=await prisma.sourceGeneration.findUnique({
      where:{id:generationId},include:{cursors:{select:{reportKey:true,reconciledAt:true}}},
    });
    assert(generation&&generation.state==="ACTIVE" &&
      (generation.validation as any)?.testingOnly===true,"Synthetic source generation required");
    assert.deepEqual(generation.cursors.filter(x=>x.reconciledAt).map(x=>x.reportKey).sort(),
      [...LOAD_ORDER].sort(),"All ten Testing cursors required");
    assert.equal(await prisma.semanticPublicationPointer.findUnique({
      where:{employerId_period_partitionKey:key},
    }),null,"Existing semantic pointer detected; never overwrite unrelated Testing data");
    const journey=await prisma.journey.findUnique({
      where:{id:journeyId},select:{monthlySavingCents:true,sourceUpdatedAt:true},
    });
    assert.equal(journey?.monthlySavingCents,10000,"Synthetic source already changed");
    originalUpdatedAt=journey!.sourceUpdatedAt;
    const initial=await readSemanticPublicationChanges({
      employerIds:[employerId],initializeAtLatest:true,
    });
    assert.equal(initial.changes.length,0);
    const cursor=initial.nextCursor??"START";

    installMemoryBroker();
    const baseline=await completeScore();
    const start=Date.now();
    const first=await publish("before",baseline.payload,null,new Date(start-45_000));
    assert(first.published);
    const canaryBefore=await readPublishedSemanticPartition(key);
    assert.equal(Number((canaryBefore?.payload as any)?.wellness?.score),baseline.score);

    const edit=await prisma.journey.updateMany({
      where:{id:journeyId,monthlySavingCents:10000},
      data:{monthlySavingCents:30000,sourceUpdatedAt:new Date()},
    });
    assert.equal(edit.count,1);
    changed=true;
    const revised=await completeScore();
    assert.notEqual(revised.score,baseline.score,"Canonical change must affect real score calculation");
    const second=await publish("after",revised.payload,first.manifestId,new Date(start-10_000));
    assert(second.published);
    const canaryAfter=await readPublishedSemanticPartition(key);
    assert.equal(Number((canaryAfter?.payload as any)?.wellness?.score),revised.score);
    assert.equal(canaryAfter?.manifestId,second.manifestId);

    const events=await readSemanticPublicationChanges({afterId:cursor,employerIds:[employerId]});
    assert.equal(events.changes.filter(x=>x.action==="PUBLISH").length,2);
    assert(events.changes.every(x=>x.employerId===employerId));

    const reverted=await rollbackSemanticPublication({
      ...key,expectedCurrentManifestId:second.manifestId,
      restoreManifestId:first.manifestId,actor:"isolated-full-e2e",
      reason:"synthetic rollback acceptance",
    });
    assert(reverted.rolledBack);
    const canaryRestored=await readPublishedSemanticPartition(key);
    assert.equal(Number((canaryRestored?.payload as any)?.wellness?.score),baseline.score);
    const rollbackEvents=await readSemanticPublicationChanges({
      afterId:events.nextCursor??"START",employerIds:[employerId],
    });
    assert(rollbackEvents.changes.some(x=>x.action==="ROLLBACK"));
    console.log(JSON.stringify({
      test:"isolated-Neon-canonical-to-publication-feed-to-canary",
      baselineScore:baseline.score,revisedScore:revised.score,
      persistedScoreDelta:true,publicationEvents:2,rollbackObserved:true,
      externalDurabilityVerified:false,browserWithRealApiTested:false,
      syntheticStorage:"in-memory-HTTPS",productionModified:false,
    }));
  }finally{
    for(const [name,value] of previousEnv){
      if(value===undefined)delete process.env[name];else process.env[name]=value;
    }
    globalThis.fetch=previousFetch;
    try{
      if(ownedVersions.length){
        const owned=await prisma.semanticSnapshotManifest.findMany({
          where:{generationId,employerId,period,partitionKey,version:{in:ownedVersions}},
          select:{id:true},
        });
        const ids=owned.map(x=>x.id);
        const current=await prisma.semanticPublicationPointer.findUnique({
          where:{employerId_period_partitionKey:key},select:{manifestId:true},
        });
        if(current&&!ids.includes(current.manifestId))
          throw new Error("Foreign semantic pointer detected; aborting cleanup");
        await prisma.semanticPublicationPointer.deleteMany({
          where:{...key,manifestId:{in:ids}},
        });
        await prisma.semanticPublicationAudit.deleteMany({
          where:{...key,nextManifestId:{in:ids}},
        });
        await prisma.semanticSnapshotManifest.deleteMany({
          where:{generationId,employerId,period,partitionKey,version:{in:ownedVersions}},
        });
      }
      if(changed){
        const restore=await prisma.journey.updateMany({
          where:{id:journeyId,monthlySavingCents:30000},
          data:{monthlySavingCents:10000,sourceUpdatedAt:originalUpdatedAt},
        });
        assert.equal(restore.count,1,"Synthetic journey restoration needs manual Testing review");
        const baselineRestored=await snapshotEmployer(employerId,period);
        assert(baselineRestored.persisted&&baselineRestored.scoreReady,
          "Synthetic baseline score restoration needs manual Testing review");
      }
    }finally{await prisma.$disconnect();}
  }
}
run().catch(e=>{console.error("Isolated score-to-canary rehearsal failed:",e?.message??String(e));process.exitCode=1;});
