// Semantic write-side publisher. Never changes the live dashboard read path.
// Only verified objects become candidates; CAS prevents concurrent clobbers.
import { prisma } from "./snapshotBuilder.js";

export async function publishVerifiedSemanticManifest(input:{
  manifestId:string; expectedPreviousManifestId:string|null;
  verifiedSha256:string; verifiedBytes:number;
  actor:string; reason:string;
}) {
  if (!/^[a-f0-9]{64}$/.test(input.verifiedSha256)) throw new Error("Invalid verified digest");
  if (!Number.isSafeInteger(input.verifiedBytes) || input.verifiedBytes<=0) throw new Error("Invalid verified size");
  if (!input.actor.trim() || !input.reason.trim()) throw new Error("Audit actor and reason required");
  return prisma.$transaction(async tx=>{
    const m=await tx.semanticSnapshotManifest.findUnique({where:{id:input.manifestId}});
    if (!m || m.state!=="STAGED") throw new Error("Manifest must be staged");
    if (m.contentSha256!==input.verifiedSha256 || m.bytes!==input.verifiedBytes || !m.validatedAt) throw new Error("Object integrity or validation mismatch");
    const generation=await tx.sourceGeneration.findUnique({where:{id:m.generationId},include:{cursors:true}});
    if (!generation?.validatedAt || !["VALIDATED","ACTIVE"].includes(generation.state)) throw new Error("Unvalidated source generation");
    const reconciled=new Set(generation.cursors.filter(x=>x.reconciledAt).map(x=>x.reportKey));
    for(const feed of ["employers","workforce_snapshots","employees","platform_users","journeys","debt_accounts","policies","ratings","referrals","salary_advances"]) {
      if(!reconciled.has(feed)) throw new Error("Canonical feed reconciliation incomplete");
    }
    const key={employerId:m.employerId,period:m.period,partitionKey:m.partitionKey};
    const existing=await tx.semanticPublicationPointer.findUnique({where:{employerId_period_partitionKey:key}});
    if((existing?.manifestId??null)!==input.expectedPreviousManifestId) throw new Error("Publication version conflict");
    // Atomic insert/update with optimistic comparison. Row-locking avoids
    // concurrent publishers both committing from the same previous version.
    if(existing) {
      const updated=await tx.semanticPublicationPointer.updateMany({where:{id:existing.id,manifestId:existing.manifestId},data:{manifestId:m.id,generationId:m.generationId}});
      if(updated.count!==1) throw new Error("Concurrent publication conflict");
    } else {
      await tx.semanticPublicationPointer.create({data:{...key,manifestId:m.id,generationId:m.generationId}});
    }
    await tx.semanticSnapshotManifest.update({where:{id:m.id},data:{state:"PUBLISHED",publishedAt:new Date()}});
    await tx.semanticPublicationAudit.create({data:{...key,previousManifestId:existing?.manifestId??null,nextManifestId:m.id,action:"PUBLISH",reason:`${input.actor}: ${input.reason}`}});
    return {published:true,manifestId:m.id,previousManifestId:existing?.manifestId??null};
  },{isolationLevel:"Serializable",timeout:10_000});
}

// Reversal changes only the semantic publication pointer, not source credentials.
export async function rollbackSemanticPublication(input:{
  employerId:string;period:string;partitionKey:string; expectedCurrentManifestId:string;
  restoreManifestId:string;actor:string;reason:string;
}){
  if (!input.actor.trim() || !input.reason.trim()) throw new Error("Audit actor and reason required");
  if(input.restoreManifestId===input.expectedCurrentManifestId) throw new Error("Rollback target must differ");
  return prisma.$transaction(async tx=>{
    const current=await tx.semanticPublicationPointer.findUnique({where:{employerId_period_partitionKey:{
      employerId:input.employerId,period:input.period,partitionKey:input.partitionKey
    }}});
    if(!current || current.manifestId!==input.expectedCurrentManifestId) throw new Error("Concurrent publication change");
    const target=await tx.semanticSnapshotManifest.findUnique({where:{id:input.restoreManifestId}});
    if(!target || target.state!=="PUBLISHED" || !target.validatedAt || target.employerId!==input.employerId ||
      target.period!==input.period || target.partitionKey!==input.partitionKey) throw new Error("Invalid rollback target");
    const result=await tx.semanticPublicationPointer.updateMany({where:{id:current.id,manifestId:current.manifestId},
      data:{manifestId:target.id,generationId:target.generationId}});
    if(result.count!==1) throw new Error("Concurrent publication conflict");
    await tx.semanticPublicationAudit.create({data:{employerId:input.employerId,period:input.period,partitionKey:input.partitionKey,
      previousManifestId:current.manifestId,nextManifestId:target.id,action:"ROLLBACK",reason:`${input.actor}: ${input.reason}`}});
    return {rolledBack:true,manifestId:target.id};
  },{isolationLevel:"Serializable",timeout:10_000});
}
