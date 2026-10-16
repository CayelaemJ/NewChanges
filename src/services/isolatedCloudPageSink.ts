// Isolated S3-compatible content-addressed page storage for Playground.
// No production publisher, no database writes, no mutable cloud checkpoint.
// Caller owns a single-writer lease and a durable checkpoint ledger.
import {createHash} from "node:crypto";
import {presignS3Request} from "./semanticS3Broker.js";
import {LOAD_ORDER} from "./reportFormats.js";
import type {MappedStagingSink} from "./canonicalMappedStagingRunner.js";
import type {KeysetCursor} from "./datasetReplacementKeysetSql.js";

const sha=(b:Uint8Array)=>createHash("sha256").update(b).digest("hex");
const identity=/^[a-zA-Z0-9_-]{1,128}$/;
const hex=/^[0-9a-f]{64}$/;
export interface CloudStageHttp {
 put(url:string,body:Uint8Array):Promise<void>;
 get(url:string,maximumBytes:number):Promise<Uint8Array>;
}
export interface CloudPageReceipt{
 objectKey:string;sha256:string;bytes:number;generation:string;snapshotId:string;
 feed:string;cursor:KeysetCursor;pageDigest:string;
}
/** Only immutable objects: no cloud-side mutable cursor without CAS/fencing. */
export function createIsolatedCloudPageSink(
 http:CloudStageHttp,
 recordReceipt:(receipt:CloudPageReceipt)=>Promise<void>,
 env:NodeJS.ProcessEnv=process.env,
 maxObjectBytes=2*1024*1024,
 maxTotalNetworkBytes=64*1024*1024,
){
 if(!Number.isSafeInteger(maxObjectBytes)||maxObjectBytes<1||maxObjectBytes>16*1024*1024)
  throw new Error("Invalid cloud page budget");
 if(!Number.isSafeInteger(maxTotalNetworkBytes)||maxTotalNetworkBytes<1||
   maxTotalNetworkBytes>128*1024*1024)
  throw new Error("Invalid aggregate staging network budget");
 let reservedNetworkBytes=0;
 if(typeof http?.put!=="function"||typeof http?.get!=="function"||
    typeof recordReceipt!=="function")throw new Error("Missing trusted cloud staging collaborators");
 const sink:MappedStagingSink={async commitPage(input){
  const {generation,snapshotId,feed,rows,after,pageDigest}=input;
  if(!identity.test(generation)||!identity.test(snapshotId)||!LOAD_ORDER.includes(feed)||
    !hex.test(pageDigest)||!Array.isArray(rows)||rows.length<1||rows.length>1000)
   throw new Error("Invalid cloud staging page identity");
  const actualPageDigest=sha(Buffer.from(JSON.stringify(rows),"utf8"));
  if(actualPageDigest!==pageDigest)throw new Error("Staged page digest does not match rows");
  const data=Buffer.from(JSON.stringify({rows,after,pageDigest}),"utf8");
  if(data.length>maxObjectBytes)throw new Error("Cloud page exceeds byte budget");
  // Count both PUT and full GET verification to avoid hidden 2x transfer
  // amplification. Reservation happens before any network I/O and is never
  // refunded on uncertain failures (fail closed against overspending).
  if(data.length>Math.floor((maxTotalNetworkBytes-reservedNetworkBytes)/2))
   throw new Error("Aggregate staged network-byte budget exceeded");
  reservedNetworkBytes+=data.length*2;
  const digest=sha(data);
  const objectKey=`semantic/staging/${generation}/${snapshotId}/${feed}/${digest}.json`;
  // Object data is immutable by content address; a failed upload must never
  // advance the caller's durable ledger.
  await http.put(presignS3Request({method:"PUT",key:objectKey},env),data);
  const readback=await http.get(presignS3Request({method:"GET",key:objectKey},env),maxObjectBytes);
  if(!(readback instanceof Uint8Array)||readback.byteLength!==data.byteLength||
    sha(readback)!==digest)throw new Error("Cloud staging readback checksum mismatch");
  await recordReceipt({objectKey,sha256:digest,bytes:data.length,
   generation,snapshotId,feed,cursor:after,pageDigest});
 }};
 return {sink,productionEnabled:false as const,publicationEnabled:false as const};
}
