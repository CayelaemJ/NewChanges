// Durable refresh work queue: enqueue only after source records commit.
// Duplicate hosts share one idempotency key and claim jobs with SKIP LOCKED.
import { createHash } from "node:crypto";
import { prisma } from "./snapshotBuilder.js";
import type { RefreshPartition } from "./semanticRefreshPlanner.js";

export async function enqueueSemanticRefresh(generationId:string, watermark:Date, partitions:RefreshPartition[]) {
  if (!generationId || !Number.isFinite(watermark.getTime())) throw new Error("Invalid source generation or watermark");
  let queued=0, deduplicated=0;
  for (const part of partitions) {
    const idempotencyKey=createHash("sha256").update(JSON.stringify([generationId,part.employerId,part.period,"all",watermark.toISOString()])).digest("hex");
    const inserted=await prisma.semanticRefreshJob.createMany({
      data:[{idempotencyKey,generationId,employerId:part.employerId,period:part.period,partitionKey:"all",sourceWatermark:watermark,changedFeeds:part.feeds,status:"PENDING"}],
      skipDuplicates:true,
    });
    if(inserted.count) queued++; else deduplicated++;
  }
  return {queued,deduplicated};
}

export async function claimSemanticRefresh(workerId:string, leaseSeconds=120) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(workerId)) throw new Error("Invalid worker");
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 30 || leaseSeconds > 900) throw new Error("Invalid lease");
  const rows=await prisma.$queryRaw<Array<{id:string;generationId:string;employerId:string;period:string;partitionKey:string;sourceWatermark:Date}>>`
    UPDATE "SemanticRefreshJob"
    SET status='RUNNING', "workerId"=${workerId}, "leasedUntil"=now()+(${leaseSeconds} * interval '1 second'),
        attempts=attempts+1, "updatedAt"=now()
    WHERE id IN (
      SELECT id FROM "SemanticRefreshJob"
      WHERE ((status='PENDING' AND "availableAt"<=now()) OR (status='RUNNING' AND "leasedUntil"<now()))
        AND attempts < 5
      ORDER BY "availableAt" ASC
      FOR UPDATE SKIP LOCKED LIMIT 1
    )
    RETURNING id,"generationId","employerId",period,"partitionKey","sourceWatermark"
  `;
  return rows[0] ?? null;
}

// Recover crash-expired leases and surface exhausted jobs rather than allowing
// them to remain RUNNING or PENDING forever and disappear from worker claims.
export async function reconcileExpiredSemanticRefreshLeases() {
  const now=new Date();
  const exhausted=await prisma.semanticRefreshJob.updateMany({
    where:{attempts:{gte:5},status:{in:["PENDING","RUNNING"]},OR:[{leasedUntil:null},{leasedUntil:{lt:now}}]},
    data:{status:"FAILED",leasedUntil:null,workerId:null,lastError:"Retry limit exhausted; manual review required"},
  });
  return {failed:exhausted.count};
}

export async function finishSemanticRefresh(id:string,workerId:string,success:boolean,error?:string) {
  const row=await prisma.semanticRefreshJob.updateMany({
    where:{id,workerId,status:"RUNNING",leasedUntil:{gt:new Date()}},
    data:success
      ? {status:"COMPLETED",leasedUntil:null,workerId:null,lastError:null}
      : {status:"PENDING",availableAt:new Date(Date.now()+60_000),leasedUntil:null,workerId:null,lastError:(error||"Processing failed").slice(0,1000)},
  });
  if(row.count!==1) throw new Error("Refresh lease expired or owned by another worker");
}
