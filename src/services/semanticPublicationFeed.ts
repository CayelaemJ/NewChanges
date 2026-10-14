// Cross-deployment semantic version feed: reads durable publication audit,
// not process-local SSE state. This is a bounded polling endpoint suitable for
// both Railway and Render; it never recalculates the dashboard.
import { prisma } from "./snapshotBuilder.js";

export async function readSemanticPublicationChanges(input:{
  afterId?:string;limit?:number;employerIds?:string[];initializeAtLatest?:boolean;
}) {
  const requested = input.limit ?? 50;
  if (!Number.isFinite(requested)) throw new Error("Invalid publication page size");
  const limit=Math.max(1,Math.min(100,Math.floor(requested)));
  const after=input.afterId ? await prisma.semanticPublicationAudit.findUnique({where:{id:input.afterId},select:{id:true,createdAt:true}}) : null;
  if(input.afterId && !after) throw new Error("Unknown publication cursor");
  const employers=[...new Set(input.employerIds??[])];
  if(employers.length>200) throw new Error("Employer filter exceeds limit");
  if (!input.afterId && input.initializeAtLatest) {
    const latest = await prisma.semanticPublicationAudit.findFirst({
      where: employers.length ? { employerId: { in: employers } } : undefined,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: { id: true },
    });
    return { changes: [], nextCursor: latest?.id ?? null, servingEnabled: false, transport: "DURABLE_POLL" };
  }
  const rows=await prisma.semanticPublicationAudit.findMany({
    where:{
      ...(after?{OR:[{createdAt:{gt:after.createdAt}},{createdAt:after.createdAt,id:{gt:after.id}}]}:{}),
      ...(employers.length?{employerId:{in:employers}}:{}),
    },
    select:{id:true,employerId:true,period:true,partitionKey:true,nextManifestId:true,action:true,createdAt:true},
    orderBy:[{createdAt:"asc"},{id:"asc"}],
    take:limit,
  });
  return { changes:rows, nextCursor:rows.at(-1)?.id??input.afterId??null,
    servingEnabled:false, transport:"DURABLE_POLL" };
}
