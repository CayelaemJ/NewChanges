// Expensive only during a deliberate database migration, never during
// dashboard GETs or scheduled incremental checks. Reads each canonical feed
// from both sources once and stores only small integrity proofs in Neon.
import { createHash } from "node:crypto";
import { prisma } from "./snapshotBuilder.js";
import { LOAD_ORDER } from "./reportFormats.js";
import { createSourceAdapter } from "./sourceAdapter.js";
import { getConfig, openIncrementalSyncLease, closeIncrementalSyncLease } from "./syncService.js";
import { openSourceSettings } from "./sourceConnectionVault.js";
import { sourceFingerprint } from "./sourceGovernance.js";

function canonical(value:unknown):unknown {
  if(value instanceof Date) return value.toISOString();
  if(typeof value==="bigint") return String(value);
  if(Array.isArray(value)) return value.map(canonical);
  if(value && typeof value==="object")
    return Object.fromEntries(Object.entries(value as Record<string,unknown>)
      .filter(([,v])=>v!==undefined).sort(([a],[b])=>a<b?-1:a>b?1:0)
      .map(([k,v])=>[k,canonical(v)]));
  return value ?? null;
}
export function fingerprintCanonicalRecords(records:Record<string,unknown>[]):string {
  const hashes=records.map(row=>createHash("sha256").update(JSON.stringify(canonical(row))).digest("hex"));
  hashes.sort();
  const digest=createHash("sha256");
  digest.update(String(records.length)+"\n");
  for(const hash of hashes) digest.update(hash+"\n");
  return digest.digest("hex");
}
function timestamp(value:string|null|undefined):Date|null {
  if(!value)return null;
  const raw=value.trim().replace(" ","T");
  const ms=Date.parse(/(?:Z|[+-][0-9]{2}:?[0-9]{2})$/i.test(raw)?raw:raw+"Z");
  if(!Number.isFinite(ms))throw new Error("Unparseable canonical source watermark");
  return new Date(ms);
}
export async function reconcileEquivalentSourcePair(input:{
  activeGenerationId:string;candidateGenerationId:string;actor:string;reason:string;confirm:string;maxRowsPerFeed?:number;
}) {
  if(process.env.ENABLE_GOVERNED_SOURCE_CUTOVER!=="true")throw new Error("Governed source reconciliation is disabled");
  if(input.confirm!=="RECONCILE"||!input.actor.trim()||!input.reason.trim())throw new Error("RECONCILE confirmation, actor and reason required");
  const maxRows=input.maxRowsPerFeed??100_000;
  if(!Number.isInteger(maxRows)||maxRows<1||maxRows>1_000_000)throw new Error("Invalid reconciliation row budget");
  const lease=await openIncrementalSyncLease();
  if(!lease)throw new Error("Cannot reconcile while source synchronization is running");
  let oldAdapter:Awaited<ReturnType<typeof createSourceAdapter>>|null=null;
  let newAdapter:Awaited<ReturnType<typeof createSourceAdapter>>|null=null;
  try {
    const [config,active,target]=await Promise.all([
      getConfig(),
      prisma.sourceGeneration.findUnique({where:{id:input.activeGenerationId}}),
      prisma.sourceGeneration.findUnique({where:{id:input.candidateGenerationId},include:{credentialVault:true}}),
    ]);
    if(!active||active.state!=="ACTIVE"||!target||target.state!=="VALIDATED"||!target.credentialVault)
      throw new Error("Invalid active and candidate source generations");
    if(sourceFingerprint(config)!==active.fingerprint)throw new Error("Active source identity changed since staging");
    const candidate=openSourceSettings(target.id,target.credentialVault);
    if(sourceFingerprint({...config,...candidate})!==target.fingerprint)throw new Error("Candidate vault identity mismatch");
    oldAdapter=await createSourceAdapter(config);
    newAdapter=await createSourceAdapter({...config,...candidate});
    if(oldAdapter.mode!=="SQL"||newAdapter.mode!=="SQL"||
       !oldAdapter.describe||!newAdapter.describe||!oldAdapter.watermark||!newAdapter.watermark)
      throw new Error("Content reconciliation currently requires canonical SQL views");
    const rows:Array<{reportKey:string;rowCount:number;digest:string;watermark:Date|null}>=[];
    for(const key of LOAD_ORDER) {
      const [oldStats,newStats]=await Promise.all([oldAdapter.describe(key),newAdapter.describe(key)]);
      if(oldStats.totalRows>maxRows||newStats.totalRows>maxRows)
        throw new Error(`Feed ${key} exceeds reconciliation row budget; no source was switched`);
      if(oldStats.totalRows!==newStats.totalRows)
        throw new Error(`Feed ${key} differs in row count; new dataset requires separately staged semantic rebuild`);
      const through=new Date();
      const [oldBefore,newBefore]=await Promise.all([oldAdapter.watermark(key),newAdapter.watermark(key)]);
      const [oldData,newData]=await Promise.all([
        oldAdapter.fetchReport(key,{through}),newAdapter.fetchReport(key,{through}),
      ]);
      const [oldAfter,newAfter]=await Promise.all([oldAdapter.watermark(key),newAdapter.watermark(key)]);
      const initialOld=timestamp(oldBefore.newest),initialNew=timestamp(newBefore.newest);
      if(initialOld?.getTime()!==timestamp(oldAfter.newest)?.getTime()||
         initialNew?.getTime()!==timestamp(newAfter.newest)?.getTime())
        throw new Error(`Feed ${key} changed during reconciliation; retry after source stabilizes`);
      if(initialOld?.getTime()!==initialNew?.getTime() ||
         oldData.records.length!==oldStats.totalRows || newData.records.length!==newStats.totalRows)
        throw new Error(`Feed ${key} has different watermarks or incomplete records`);
      const digestOld=fingerprintCanonicalRecords(oldData.records);
      const digestNew=fingerprintCanonicalRecords(newData.records);
      if(digestOld!==digestNew)
        throw new Error(`Feed ${key} content differs; equivalent database cutover blocked`);
      rows.push({reportKey:key,rowCount:oldData.records.length,digest:digestOld,watermark:initialOld});
    }
    const reconciledAt=new Date();
    await prisma.$transaction(async tx=>{
      const [a,b]=await Promise.all([
        tx.sourceGeneration.findUnique({where:{id:active.id}}),
        tx.sourceGeneration.findUnique({where:{id:target.id}}),
      ]);
      if(a?.state!=="ACTIVE"||b?.state!=="VALIDATED")throw new Error("Source generation status changed during reconciliation");
      for(const row of rows){
        for(const generationId of [active.id,target.id]) {
          await tx.sourceGenerationCursor.upsert({
            where:{generationId_reportKey:{generationId,reportKey:row.reportKey}},
            create:{generationId,reportKey:row.reportKey,rowCount:row.rowCount,digest:row.digest,
              lastSourceUpdatedAt:row.watermark,reconciledAt},
            update:{rowCount:row.rowCount,digest:row.digest,lastSourceUpdatedAt:row.watermark,reconciledAt},
          });
        }
      }
      await tx.sourceActivationAudit.create({data:{
        previousGenerationId:active.id,nextGenerationId:target.id,actor:input.actor,reason:input.reason,action:"RECONCILED_EQUIVALENT",
      }});
    },{isolationLevel:"Serializable",timeout:30_000});
    return {ok:true,feeds:rows.length,reconciledAt:reconciledAt.toISOString(),candidateGenerationId:target.id,
      note:"All ten feeds match by record count, canonical SHA-256 digest and watermark; no dashboard records were rewritten"};
  }finally{
    await Promise.allSettled([oldAdapter?.close(),newAdapter?.close()]);
    await closeIncrementalSyncLease(lease);
  }
}
