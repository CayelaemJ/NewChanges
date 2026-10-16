// Fenced cloud staging receipt callback. Does not mutate live source cursors
// or publish to Neon. Requires the separately reviewed checkpoint table.
import {createFencedStagingLedger,type FencedLease,type FencedReceipt} from "./fencedStagingLedger.js";
import type {CloudPageReceipt} from "./isolatedCloudPageSink.js";
import type {StagingSqlExecutor} from "./fencedStagingLedger.js";

export async function createFencedCloudReceiptRecorder(
 db:StagingSqlExecutor,generation:string,feed:string,owner:string,
 leaseSeconds=120,
){
 const ledger=createFencedStagingLedger(db);
 let lease:FencedLease=await ledger.acquire(generation,feed,owner,leaseSeconds);
 let writing=false;
 let lastLeaseTouch=Date.now();
 return {
  async recordReceipt(receipt:CloudPageReceipt){
   if(writing)throw new Error("Concurrent staging receipts are forbidden");
   writing=true;
   try{
    if(receipt.generation!==generation||receipt.feed!==feed)
     throw new Error("Receipt is outside the fenced source generation or feed");
    const candidate:FencedReceipt={
     generation,feed,snapshotId:receipt.snapshotId,
     objectKey:receipt.objectKey,sha256:receipt.sha256,
     cursor:receipt.cursor,expectedVersion:lease.version,
    };
    // Refresh only when needed to avoid extra Neon queries per page.
    if(Date.now()-lastLeaseTouch>=Math.max(1000,Math.floor(leaseSeconds*1000/3))){
     lease=await ledger.renew(lease,leaseSeconds);
     lastLeaseTouch=Date.now();
    }
    lease=await ledger.commit(lease,candidate);
   }finally{writing=false;}
  },
  currentVersion(){return lease.version;},
  publicationEnabled:false as const,
 };
}
