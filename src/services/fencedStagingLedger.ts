// Candidate PostgreSQL checkpoint-ledger adapter, isolated from live imports.
// The table is NOT automatically migrated or used by production. All ledger
// transitions are atomic database statements with monotonic fencing tokens.
import {LOAD_ORDER} from "./reportFormats.js";
export interface StagingSqlExecutor{
 query<T extends Record<string,unknown>>(sql:string,params:readonly unknown[]):Promise<readonly T[]>;
}
export interface FencedLease {generation:string;feed:string;owner:string;fence:bigint;version:bigint;}
export interface FencedReceipt{
 generation:string;feed:string;snapshotId:string;objectKey:string;
 sha256:string;cursor:Record<string,unknown>;expectedVersion:bigint;
}
const safe=/^[a-zA-Z0-9_-]{1,128}$/;
const hex=/^[a-f0-9]{64}$/;
function checkScope(generation:string,feed:string,owner?:string){
 if(!safe.test(generation)||!LOAD_ORDER.includes(feed)||(owner!==undefined&&!safe.test(owner)))
  throw new Error("Invalid fenced staging identity");
}
function toBigInt(v:unknown):bigint{
 if(typeof v!=="string"&&typeof v!=="number"&&typeof v!=="bigint")
  throw new Error("Invalid database fencing token");
 const n=BigInt(v);
 if(n<0n)throw new Error("Invalid database fencing token");
 return n;
}
export function createFencedStagingLedger(db:StagingSqlExecutor){
 return {
  async acquire(generation:string,feed:string,owner:string,leaseSeconds=30):Promise<FencedLease>{
   checkScope(generation,feed,owner);
   if(!Number.isSafeInteger(leaseSeconds)||leaseSeconds<10||leaseSeconds>120)
    throw new Error("Invalid staging lease lifetime");
   const sql=`INSERT INTO "MappedStagingCheckpoint"
       ("generation","feed","owner","fence","version","leaseExpiresAt")
       VALUES ($1,$2,$3,1,0,now() + ($4::integer * interval '1 second'))
       ON CONFLICT ("generation","feed") DO UPDATE
       SET "owner"=EXCLUDED."owner",
           "fence"="MappedStagingCheckpoint"."fence"+1,
           "leaseExpiresAt"=EXCLUDED."leaseExpiresAt"
       WHERE "MappedStagingCheckpoint"."leaseExpiresAt" < now()
       RETURNING "fence","version"`;
   const rows=await db.query<{fence:unknown;version:unknown}>(sql,[generation,feed,owner,leaseSeconds]);
   if(rows.length!==1)throw new Error("Staging lease is held by another worker");
   return {generation,feed,owner,fence:toBigInt(rows[0].fence),version:toBigInt(rows[0].version)};
  },
  async commit(lease:FencedLease,receipt:FencedReceipt):Promise<FencedLease>{
   checkScope(lease.generation,lease.feed,lease.owner);
   if(receipt.generation!==lease.generation||receipt.feed!==lease.feed||
      !safe.test(receipt.snapshotId)||!hex.test(receipt.sha256)||
      receipt.expectedVersion!==lease.version||
      typeof receipt.objectKey!=="string"||
      receipt.objectKey!==`semantic/staging/${receipt.generation}/${receipt.snapshotId}/${receipt.feed}/${receipt.sha256}.json`||
      !receipt.cursor||typeof receipt.cursor!=="object"||Array.isArray(receipt.cursor)||
      lease.fence<1n||lease.version<0n)
    throw new Error("Invalid or foreign staged receipt");
   const sql=`UPDATE "MappedStagingCheckpoint"
      SET "version"="version"+1,"snapshotId"=$6,"objectKey"=$7,
          "sha256"=$8,"cursor"=$9::jsonb,"updatedAt"=now()
      WHERE "generation"=$1 AND "feed"=$2 AND "owner"=$3
        AND "fence"=$4::bigint AND "version"=$5::bigint
        AND "leaseExpiresAt">now()
        AND ("snapshotId" IS NULL OR "snapshotId"=$6)
      RETURNING "version"`;
   const rows=await db.query<{version:unknown}>(sql,[
    lease.generation,lease.feed,lease.owner,lease.fence.toString(),lease.version.toString(),
    receipt.snapshotId,receipt.objectKey,receipt.sha256,JSON.stringify(receipt.cursor)]);
   if(rows.length!==1)throw new Error("Stale staging lease, snapshot, or checkpoint version");
   return {...lease,version:toBigInt(rows[0].version)};
  },
  async inspect(generation:string,feed:string){
   checkScope(generation,feed);
   const sql=`SELECT "snapshotId","objectKey","sha256","cursor","version"
      FROM "MappedStagingCheckpoint"
      WHERE "generation"=$1 AND "feed"=$2`;
   const rows=await db.query<Record<string,unknown>>(sql,[generation,feed]);
   return rows[0]??null;
  }
 };
}
