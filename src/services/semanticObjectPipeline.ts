// Controlled semantic write pipeline. No production dashboard reads are changed.
// Storage broker must provide short-lived presigned URLs for a tenant-scoped
// immutable object key. This API must remain server-side and authenticated.
import { createHash } from "node:crypto";
import { prisma } from "./snapshotBuilder.js";
import { putAndVerifySemanticObject } from "./semanticObjectVerification.js";
import { evaluatePublicationGates } from "./semanticPublicationGates.js";
import { publishVerifiedSemanticManifest } from "./semanticPublisher.js";
import { LOAD_ORDER } from "./reportFormats.js";

export async function stageAndPublishSemanticObject(input: {
  generationId:string;employerId:string;period:string;partitionKey:string;version:string;
  objectKey:string;putUrl:string;getUrl:string;body:Uint8Array;
  sourceWatermark:Date;expectedPreviousManifestId:string|null;actor:string;reason:string;
}) {
  if (process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH !== "true") {
    throw new Error("Semantic publication is disabled; configured storage and replay validation required");
  }
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(input.period)) throw new Error("Invalid reporting period");
  if (!Number.isFinite(input.sourceWatermark.getTime())) throw new Error("Invalid source watermark");
  if (!input.objectKey || input.objectKey.includes("..") || input.objectKey.startsWith("/")) throw new Error("Invalid object key");
  if (!input.objectKey.startsWith(`semantic/${input.generationId}/${input.employerId}/`)) {
    throw new Error("Storage object must be scoped to source generation and employer");
  }
  const generation=await prisma.sourceGeneration.findUnique({where:{id:input.generationId},include:{cursors:true}});
  if (!generation || !generation.validatedAt || !["VALIDATED","ACTIVE"].includes(generation.state)) {
    throw new Error("Source generation is not validated");
  }
  const feeds=generation.cursors.filter(x=>x.reconciledAt).map(x=>x.reportKey);
  // Perform inexpensive checks *before* uploading any object.
  const precheck=evaluatePublicationGates({
    sourceValidated:true,reconciledFeeds:feeds,storageVerified:true,sha256Verified:true,
    partitionNonempty:input.body.length>0,watermark:input.sourceWatermark,
  });
  if (!precheck.ready) throw new Error(`Semantic release gates failed: ${precheck.gates.filter(x=>!x.passed).map(x=>x.key).join(", ")}`);
  const proof=await putAndVerifySemanticObject({putUrl:input.putUrl,getUrl:input.getUrl,content:input.body});
  const expected=createHash("sha256").update(input.body).digest("hex");
  if (proof.sha256!==expected || proof.bytes!==input.body.length) throw new Error("Verified object mismatch");
  const manifest=await prisma.semanticSnapshotManifest.create({data:{
    generationId:input.generationId,employerId:input.employerId,period:input.period,
    partitionKey:input.partitionKey,version:input.version,objectKey:input.objectKey,
    contentSha256:proof.sha256,bytes:proof.bytes,sourceWatermark:input.sourceWatermark,
    state:"STAGED",validatedAt:new Date(proof.verifiedAt),
  }});
  // No exception can publish a pointer unless object GET succeeded and
  // all ten canonical feeds have reconciliation checkpoints.
  return publishVerifiedSemanticManifest({manifestId:manifest.id,
    expectedPreviousManifestId:input.expectedPreviousManifestId,
    verifiedSha256:proof.sha256,verifiedBytes:proof.bytes,
    actor:input.actor,reason:input.reason});
}
