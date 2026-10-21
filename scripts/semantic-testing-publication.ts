// Testing ONLY: real Prisma publication-pointer CAS and rollback rehearsal.
// Mock manifest digests are metadata fixtures, NOT verified external objects.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../src/services/snapshotBuilder.js";
import { publishVerifiedSemanticManifest, rollbackSemanticPublication } from "../src/services/semanticPublisher.js";
import { LOAD_ORDER } from "../src/services/reportFormats.js";

const databaseName="newchanges_testing_20261017";
const employerId="__synthetic_semantic_e2e_20261019__";
const generationId="__synthetic_semantic_generation_20261019__";
const period="2026-10";
const partitionKey="all";
const key={employerId,period,partitionKey};
const ownedIds:string[]=[];

function guard() {
  if(process.env.SEMANTIC_SYNTHETIC_E2E_APPROVED!=="YES_TEST_ONLY")
    throw new Error("Explicit Testing-only approval required");
  let u:URL;
  try {u=new URL(process.env.DATABASE_URL??"");} catch {throw new Error("Missing Testing Neon URL");}
  if(!["postgres:","postgresql:"].includes(u.protocol) ||
      !u.hostname.endsWith(".neon.tech") || u.pathname!=="/"+databaseName ||
      u.searchParams.get("sslmode")!=="require")
    throw new Error("Refusing non-isolated Neon Testing database");
  if(["ENABLE_SEMANTIC_SHADOW_WORKER","ENABLE_SEMANTIC_OBJECT_PUBLISH",
      "ENABLE_SEMANTIC_DASHBOARD_SERVING"].some(k=>process.env[k]==="true"))
    throw new Error("Live serving and publication must be disabled in Testing rehearsal");
}

async function stage(label:string,watermark:Date) {
  const id="synthetic-"+randomUUID();
  const version="synthetic-"+randomUUID();
  const body=Buffer.from(JSON.stringify({synthetic:true,label,id}),"utf8");
  const verifiedSha256=createHash("sha256").update(body).digest("hex");
  const verifiedBytes=body.byteLength;
  await prisma.semanticSnapshotManifest.create({data:{
    id,generationId,employerId,period,partitionKey,version,
    objectKey:"semantic/"+generationId+"/"+employerId+"/"+period+"/"+version+".json",
    contentSha256:verifiedSha256,bytes:verifiedBytes,sourceWatermark:watermark,
    state:"STAGED",validatedAt:new Date(),
  }});
  ownedIds.push(id);
  return {manifestId:id,verifiedSha256,verifiedBytes};
}

async function main() {
  guard();
  try {
    const actual=await prisma.$queryRaw<Array<{name:string}>>`SELECT current_database() AS name`;
    assert.equal(actual[0]?.name,databaseName);
    const employer=await prisma.employer.findUnique({where:{id:employerId},select:{name:true}});
    assert(employer?.name.startsWith("SYNTHETIC QA ONLY"),"Synthetic employer required");
    const generation=await prisma.sourceGeneration.findUnique({
      where:{id:generationId},include:{cursors:{select:{reportKey:true,reconciledAt:true}}},
    });
    assert(generation && generation.state==="ACTIVE" &&
      (generation.validation as any)?.testingOnly===true,"Synthetic generation required");
    assert.deepEqual(generation.cursors.filter(c=>c.reconciledAt).map(c=>c.reportKey).sort(),
      [...LOAD_ORDER].sort(),"Ten synthetic reconciled feeds required");
    assert.equal(await prisma.semanticPublicationPointer.findUnique({
      where:{employerId_period_partitionKey:key},
    }),null,"Refusing to overwrite existing publication pointer");

    const now=Date.now();
    const original=await stage("initial",new Date(now-45_000));
    const updated=await stage("updated",new Date(now-15_000));
    const stale=await stage("late-old",new Date(now-60_000));
    const actor="synthetic-e2e";
    const reason="Testing metadata-only publication rehearsal";
    // Manifest digest and byte size must match the verified evidence supplied
    // by the storage pipeline. This test only exercises DB metadata matching.
    await assert.rejects(publishVerifiedSemanticManifest({
      ...original,verifiedSha256:"f".repeat(64),
      expectedPreviousManifestId:null,actor,reason,
    }),/Object integrity or validation mismatch/);
    await assert.rejects(publishVerifiedSemanticManifest({
      ...original,verifiedBytes:original.verifiedBytes+1,
      expectedPreviousManifestId:null,actor,reason,
    }),/Object integrity or validation mismatch/);
    const first=await publishVerifiedSemanticManifest({
      ...original,expectedPreviousManifestId:null,actor,reason,
    });
    assert(first.published && first.manifestId===original.manifestId);
    await assert.rejects(publishVerifiedSemanticManifest({
      ...updated,expectedPreviousManifestId:null,actor,reason,
    }),/Publication version conflict/);
    const second=await publishVerifiedSemanticManifest({
      ...updated,expectedPreviousManifestId:original.manifestId,actor,reason,
    });
    assert(second.published && second.previousManifestId===original.manifestId);
    await assert.rejects(publishVerifiedSemanticManifest({
      ...stale,expectedPreviousManifestId:updated.manifestId,actor,reason,
    }),/cannot regress source watermark/);
    await assert.rejects(rollbackSemanticPublication({
      ...key,expectedCurrentManifestId:updated.manifestId,
      restoreManifestId:stale.manifestId,actor,reason,
    }),/Invalid rollback target/);
    const current=await prisma.semanticPublicationPointer.findUnique({
      where:{employerId_period_partitionKey:key},select:{manifestId:true},
    });
    assert.equal(current?.manifestId,updated.manifestId);
    const rolled=await rollbackSemanticPublication({
      ...key,expectedCurrentManifestId:updated.manifestId,
      restoreManifestId:original.manifestId,actor,reason:"Testing rollback exercise",
    });
    assert(rolled.rolledBack && rolled.manifestId===original.manifestId);
    await assert.rejects(rollbackSemanticPublication({
      ...key,expectedCurrentManifestId:updated.manifestId,
      restoreManifestId:original.manifestId,actor,reason,
    }),/Concurrent publication change/);
    const audits=await prisma.semanticPublicationAudit.findMany({
      where:{...key,nextManifestId:{in:ownedIds}},select:{action:true},
    });
    assert.equal(audits.filter(a=>a.action==="PUBLISH").length,2);
    assert.equal(audits.filter(a=>a.action==="ROLLBACK").length,1);
    console.log(JSON.stringify({test:"semantic-testing-publication-metadata",
      published:2,staleCasBlocked:true,staleWatermarkBlocked:true,
      rollbackAudited:true,objectStoreVerified:false,browserTested:false}));
  } finally {
    try {
      if(ownedIds.length) {
        // Never remove an unrelated pointer; only this invocation's IDs.
        const existing=await prisma.semanticPublicationPointer.findUnique({
          where:{employerId_period_partitionKey:key},select:{manifestId:true},
        });
        if(existing && !ownedIds.includes(existing.manifestId))
          throw new Error("Foreign publication pointer detected; refusing cleanup");
        await prisma.semanticPublicationPointer.deleteMany({
          where:{...key,manifestId:{in:ownedIds}},
        });
        await prisma.semanticPublicationAudit.deleteMany({
          where:{...key,nextManifestId:{in:ownedIds}},
        });
        const removed=await prisma.semanticSnapshotManifest.deleteMany({
          where:{id:{in:ownedIds},generationId,employerId,period,partitionKey},
        });
        assert.equal(removed.count,ownedIds.length,"Synthetic manifest cleanup incomplete");
        console.log("Synthetic Testing publication metadata cleaned up");
      }
    } finally {
      await prisma.$disconnect();
    }
  }
}
main().catch(e=>{console.error("Testing publication metadata rehearsal:",e?.message??String(e));process.exitCode=1;});
