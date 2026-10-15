// Opt-in semantic queue consumer. Reads last successfully published dashboard
// (never raw source records) as a compatibility bootstrap. This is NOT yet a
// replacement for dependency-aware recalculation of retroactive corrections.
import { randomUUID } from "node:crypto";
import { getDashboardPayload, getPublishedDashboardPayload } from "./snapshotBuilder.js";
import { claimSemanticRefresh, finishSemanticRefresh } from "./semanticRefreshQueue.js";
import { stageAndPublishSemanticObject } from "./semanticObjectPipeline.js";
import { prisma } from "./snapshotBuilder.js";
import { getConfig } from "./syncService.js";
import { sourceFingerprint } from "./sourceGovernance.js";
import { assessShadowSemanticProvenance } from "./semanticShadowProvenance.js";

export interface SemanticStorageBroker {
  presign(input: { objectKey:string; bytes:number }):Promise<{putUrl:string;getUrl:string}>;
}

// Deliberately not started by the web process. Needs a single designated
// worker, a configured private object store, and source dependency validation.
export async function processOneShadowSemanticRefresh(workerId:string,storage:SemanticStorageBroker) {
  if(process.env.ENABLE_SEMANTIC_SHADOW_WORKER!=="true" || process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH!=="true")
    return {processed:false,reason:"shadow semantic worker disabled"};
  const job=await claimSemanticRefresh(workerId,180);
  if(!job) return {processed:false,reason:"queue empty"};
  try {
    // One bounded recomputation per durable job, not one per dashboard GET.
    // Keep shadow-only copies as the default until historical parity passes.
    const recompute=process.env.ENABLE_SEMANTIC_RECOMPUTE === "true";
    const generation=await prisma.sourceGeneration.findUnique({
      where:{id:job.generationId},select:{state:true,fingerprint:true,validatedAt:true}
    });
    const provenance=assessShadowSemanticProvenance({
      recomputeEnabled:recompute,generationId:job.generationId,
      generationState:generation?.state??null,generationFingerprint:generation?.fingerprint??null,
      validatedAt:generation?.validatedAt??null,
      activeSourceFingerprint:sourceFingerprint(await getConfig()),
    });
    if(!provenance.allowed) throw new Error("Semantic source provenance rejected: "+provenance.missing.join("; "));

    const payload=recompute
      ? await getDashboardPayload(job.employerId,{period:job.period})
      : await getPublishedDashboardPayload(job.employerId,{period:job.period});
    if(!payload) throw new Error("No previously published dashboard payload for shadow semantic snapshot");
    const body=Buffer.from(JSON.stringify({
      schemaVersion:"semantic-shadow-v1",calculationMode:recompute?"RECOMPUTED":"PUBLISHED_COPY",generationId:job.generationId,employerId:job.employerId,
      period:job.period,asAt:job.sourceWatermark.toISOString(),payload,
    }),"utf8");
    // Object keys are immutable; never replace bytes under an existing key.
    const version=randomUUID();
    const objectKey=`semantic/${job.generationId}/${job.employerId}/${job.period}/${version}.json`;
    const signed=await storage.presign({objectKey,bytes:body.byteLength});
    const current=await prisma.semanticPublicationPointer.findUnique({
      where:{employerId_period_partitionKey:{employerId:job.employerId,period:job.period,partitionKey:job.partitionKey}},
      select:{manifestId:true},
    });
    const published=await stageAndPublishSemanticObject({
      generationId:job.generationId,employerId:job.employerId,period:job.period,
      partitionKey:job.partitionKey,version,objectKey,putUrl:signed.putUrl,getUrl:signed.getUrl,body,
      sourceWatermark:job.sourceWatermark,expectedPreviousManifestId:current?.manifestId??null,
      actor:"semantic-shadow-worker",reason:`durable queue job ${job.id}`,
    });
    await finishSemanticRefresh(job.id,workerId,true);
    return {processed:true,jobId:job.id,...published};
  } catch(error:any) {
    await finishSemanticRefresh(job.id,workerId,false,error?.message||String(error)).catch(()=>{});
    return {processed:false,jobId:job.id,error:error?.message||String(error)};
  }
}
