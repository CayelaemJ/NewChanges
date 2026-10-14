// Feature-gated read of a verified private semantic object. This is a
// canary endpoint, not yet a replacement for the existing dashboard route.
import { createHash } from "node:crypto";
import { prisma } from "./snapshotBuilder.js";
import { presignS3Request } from "./semanticS3Broker.js";

export async function readPublishedSemanticPartition(input:{employerId:string;period:string;partitionKey:string}) {
 if(process.env.ENABLE_SEMANTIC_CANARY_READ!=="true") throw new Error("Semantic canary reads are disabled");
 const pointer=await prisma.semanticPublicationPointer.findUnique({
  where:{employerId_period_partitionKey:input},
 });
 if(!pointer) return null;
 const manifest=await prisma.semanticSnapshotManifest.findUnique({where:{id:pointer.manifestId}});
 if(!manifest||manifest.state!=="PUBLISHED"||!manifest.validatedAt||
    manifest.employerId!==input.employerId||manifest.period!==input.period||manifest.partitionKey!==input.partitionKey||
    manifest.generationId!==pointer.generationId) throw new Error("Semantic publication pointer failed integrity checks");
 if(manifest.bytes<1||manifest.bytes>8*1024*1024) throw new Error("Semantic object exceeds read limit");
 const url=presignS3Request({method:"GET",key:manifest.objectKey});
 const response=await fetch(url,{redirect:"error",signal:AbortSignal.timeout(20_000)});
 if(!response.ok) throw new Error("Semantic object unavailable");
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length!==manifest.bytes||
    createHash("sha256").update(bytes).digest("hex")!==manifest.contentSha256)
    throw new Error("Semantic object integrity mismatch");
 const result=JSON.parse(bytes.toString("utf8")) as {schemaVersion?:string;employerId?:string;period?:string;payload?:unknown};
 if(result.schemaVersion!=="semantic-shadow-v1"||result.employerId!==input.employerId||result.period!==input.period)
    throw new Error("Semantic object identity mismatch");
 return {manifestId:manifest.id,version:manifest.version,payload:result.payload};
}
