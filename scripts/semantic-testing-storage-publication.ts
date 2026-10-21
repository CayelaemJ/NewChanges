// Manual isolated Neon Testing ONLY: real pipeline + ephemeral, in-memory HTTPS S3 emulator.
// This is NOT proof of external S3 durability. No network egress or Railway credentials.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../src/services/snapshotBuilder.js";
import { stageAndPublishSemanticObject } from "../src/services/semanticObjectPipeline.js";
import { rollbackSemanticPublication } from "../src/services/semanticPublisher.js";
import { createSemanticStorageBroker } from "../src/services/semanticS3Broker.js";
import { LOAD_ORDER } from "../src/services/reportFormats.js";

const database="newchanges_testing_20261017";
const employerId="__synthetic_semantic_e2e_20261019__";
const generationId="__synthetic_semantic_generation_20261019__";
const period="2026-10",partitionKey="all";
const key={employerId,period,partitionKey};
const versions:string[]=[];
const stored=new Map<string,Uint8Array>();
const originalFetch=globalThis.fetch;
const originalPublish=process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH;
let corrupt=false;

function guard() {
  if(process.env.SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY")
    throw new Error("Explicit Testing-only approval required");
  let u:URL;
  try{u=new URL(process.env.DATABASE_URL??"");}catch{throw new Error("Isolated Neon DATABASE_URL required");}
  if(!["postgres:","postgresql:"].includes(u.protocol) ||
    !u.hostname.endsWith(".neon.tech") || u.pathname!=="/"+database ||
    u.searchParams.get("sslmode")!=="require")
    throw new Error("Refusing non-isolated Neon Testing database");
  if(["ENABLE_SEMANTIC_SHADOW_WORKER","ENABLE_SEMANTIC_OBJECT_PUBLISH",
      "ENABLE_SEMANTIC_DASHBOARD_SERVING"].some(k=>process.env[k]==="true"))
    throw new Error("Production workers and semantic serving must be disabled");
}

const fakeS3={
  SEMANTIC_S3_ENDPOINT:"https://synthetic-s3.example.invalid",
  SEMANTIC_S3_BUCKET:"synthetic-testing",
  SEMANTIC_S3_REGION:"eu-west-1",
  SEMANTIC_S3_ACCESS_KEY_ID:"FAKE_LOCAL_KEY",
  SEMANTIC_S3_SECRET_ACCESS_KEY:"FAKE_LOCAL_SECRET",
} as NodeJS.ProcessEnv;

function interceptSyntheticStorage() {
  globalThis.fetch=async(input,init)=>{
    const u=new URL(String(input));
    if(u.hostname!=="synthetic-s3.example.invalid" ||
      !u.pathname.startsWith("/synthetic-testing/semantic/"+generationId+"/"+employerId+"/"+period+"/") ||
      u.searchParams.get("X-Amz-Algorithm")!=="AWS4-HMAC-SHA256" ||
      !/^[0-9a-f]{64}$/.test(u.searchParams.get("X-Amz-Signature")??""))
      throw new Error("Refusing non-synthetic storage request");
    if(init?.method==="PUT"){
      stored.set(u.pathname,new Uint8Array(init.body as Uint8Array));
      return new Response(null,{status:200});
    }
    assert.equal(init?.method,"GET");
    const contents=stored.get(u.pathname);
    if(!contents)return new Response(null,{status:404});
    const body=corrupt?new TextEncoder().encode("corrupted"):contents;
    return new Response(body,{status:200,headers:{"content-length":String(body.length)}});
  };
}

async function publish(label:string,previous:string|null,sourceWatermark:Date) {
  const version="synthetic-"+randomUUID();
  versions.push(version);
  const objectKey=["semantic",generationId,employerId,period,version+".json"].join("/");
  const body=Buffer.from(JSON.stringify({
    schemaVersion:"semantic-shadow-v1",calculationMode:"RECOMPUTED",synthetic:true,
    generationId,employerId,period,partitionKey,label,asAt:sourceWatermark.toISOString(),
  }),"utf8");
  const signed=await createSemanticStorageBroker(fakeS3).presign({objectKey,bytes:body.length});
  process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH="true";
  try {
    return await stageAndPublishSemanticObject({
      generationId,employerId,period,partitionKey,version,objectKey,
      putUrl:signed.putUrl,getUrl:signed.getUrl,body,sourceWatermark,
      expectedPreviousManifestId:previous,actor:"synthetic-storage-e2e",reason:"in-memory object transport",
    });
  } finally {
    process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH="false";
  }
}

async function main() {
  guard();
  try {
    const identity=await prisma.$queryRawUnsafe<Array<{name:string}>>("SELECT current_database() AS name");
    assert.equal(identity[0]?.name,database);
    const employer=await prisma.employer.findUnique({where:{id:employerId},select:{name:true}});
    assert(employer?.name?.startsWith("SYNTHETIC QA ONLY"),"Synthetic employer required");
    const generation=await prisma.sourceGeneration.findUnique({
      where:{id:generationId},include:{cursors:{select:{reportKey:true,reconciledAt:true}}},
    });
    assert(generation && generation.state==="ACTIVE" &&
      (generation.validation as any)?.testingOnly===true,"Synthetic source generation required");
    assert.deepEqual(generation.cursors.filter(c=>c.reconciledAt).map(c=>c.reportKey).sort(),
      [...LOAD_ORDER].sort(),"Ten synthetic cursors required");
    assert.equal(await prisma.semanticPublicationPointer.findUnique({
      where:{employerId_period_partitionKey:key},
    }),null,"Refusing to replace an existing semantic publication pointer");

    interceptSyntheticStorage();
    const now=Date.now();
    corrupt=true;
    await assert.rejects(publish("corrupted",null,new Date(now-35_000)),
      /integrity check failed/);
    assert.equal(await prisma.semanticSnapshotManifest.count({
      where:{generationId,employerId,period,version:versions[0]},
    }),0,"Corrupt readback must not insert a manifest");
    assert.equal(await prisma.semanticPublicationPointer.findUnique({
      where:{employerId_period_partitionKey:key},
    }),null,"Corrupt readback must not publish");

    corrupt=false;
    const a=await publish("first",null,new Date(now-25_000));
    const b=await publish("second",a.manifestId,new Date(now-10_000));
    assert(a.published && b.published);
    const current=await prisma.semanticPublicationPointer.findUnique({
      where:{employerId_period_partitionKey:key},select:{manifestId:true},
    });
    assert.equal(current?.manifestId,b.manifestId);
    const rollback=await rollbackSemanticPublication({
      ...key,expectedCurrentManifestId:b.manifestId,restoreManifestId:a.manifestId,
      actor:"synthetic-storage-e2e",reason:"Testing-only rollback",
    });
    assert(rollback.rolledBack);
    const audits=await prisma.semanticPublicationAudit.findMany({
      where:{...key,nextManifestId:{in:[a.manifestId,b.manifestId]}},select:{action:true},
    });
    assert.equal(audits.filter(x=>x.action==="PUBLISH").length,2);
    assert.equal(audits.filter(x=>x.action==="ROLLBACK").length,1);
    console.log(JSON.stringify({test:"synthetic-Neon-storage-publication",
      rejectedCorruptReadback:true,publishedVersions:2,rollbackAudited:true,
      realNeonTransactions:true,objectTransport:"in-memory-emulator",
      externalDurabilityVerified:false,productionModified:false}));
  } finally {
    if(originalPublish===undefined) delete process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH;
    else process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH=originalPublish;
    globalThis.fetch=originalFetch;
    try {
      if(versions.length){
        const manifests=await prisma.semanticSnapshotManifest.findMany({
          where:{generationId,employerId,period,partitionKey,version:{in:versions}},
          select:{id:true},
        });
        const ids=manifests.map(m=>m.id);
        const pointer=await prisma.semanticPublicationPointer.findUnique({
          where:{employerId_period_partitionKey:key},select:{manifestId:true},
        });
        if(pointer && !ids.includes(pointer.manifestId))
          throw new Error("Foreign pointer; refusing cleanup");
        await prisma.semanticPublicationPointer.deleteMany({
          where:{...key,manifestId:{in:ids}},
        });
        await prisma.semanticPublicationAudit.deleteMany({
          where:{...key,nextManifestId:{in:ids}},
        });
        await prisma.semanticSnapshotManifest.deleteMany({
          where:{generationId,employerId,period,partitionKey,version:{in:versions}},
        });
        console.log("Only owned synthetic publication records cleaned up");
      }
    } finally {
      await prisma.$disconnect();
    }
  }
}
main().catch(e=>{console.error("Isolated storage publication test:",e?.message??String(e));process.exitCode=1;});
