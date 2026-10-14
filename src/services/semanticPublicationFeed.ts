// Cross-deployment semantic version feed: reads durable publication audit,
// not process-local SSE state. This is a bounded polling endpoint suitable for
// both Railway and Render; it never recalculates the dashboard.
import { prisma } from "./snapshotBuilder.js";

export async function readSemanticPublicationChanges(input:{
  after?:string;limit?:number;employerIds?:string[];
}) {
  const limit=Math.max(1,Math.min(100,Math.floor(input.limit??50)));
  const after=input.after ? new Date(input.after) : null;
  if (after && !Number.isFinite(after.getTime())) throw new Error("Invalid publication cursor");
  const employers=[...new Set(input.employerIds??[])];
  if(employers.length>200) throw new Error("Employer filter exceeds limit");
  const rows=await prisma.semanticPublicationAudit.findMany({
    where:{
      ...(after?{createdAt:{gt:after}}:{}),
      ...(employers.length?{employerId:{in:employers}}:{}),
    },
    select:{id:true,employerId:true,period:true,partitionKey:true,nextManifestId:true,action:true,createdAt:true},
    orderBy:[{createdAt:"asc"},{id:"asc"}],
    take:limit,
  });
  return { changes:rows, nextCursor:rows.at(-1)?.createdAt.toISOString()??input.after??null,
    servingEnabled:false, transport:"DURABLE_POLL" };
}
