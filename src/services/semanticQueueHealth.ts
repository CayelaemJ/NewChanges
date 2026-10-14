// Read-only operational telemetry for staged semantic refresh.
// This endpoint must never recompute dashboard aggregates on request.
import { prisma } from "./snapshotBuilder.js";
export async function getSemanticQueueHealth() {
  const [groups, oldest, recentFailures] = await Promise.all([
    prisma.semanticRefreshJob.groupBy({_count:{id:true},by:["status"]}),
    prisma.semanticRefreshJob.findFirst({where:{status:"PENDING"},orderBy:{createdAt:"asc"},select:{createdAt:true}}),
    prisma.semanticRefreshJob.findMany({where:{status:"FAILED"},orderBy:{updatedAt:"desc"},take:10,
      select:{id:true,employerId:true,period:true,attempts:true,lastError:true,updatedAt:true}}),
  ]);
  return {
    counts:Object.fromEntries(groups.map(x=>[x.status,x._count.id])),
    oldestPendingAt:oldest?.createdAt??null,
    recentFailures,
    pipelineEnabled:process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH==="true",
    servingEnabled:false,
  };
}
