// Fail-closed, fully audited equivalent-source cutover. This operation
// NEVER imports or purges historical facts. A different dataset needs an
// independently staged semantic generation and is not eligible for this path.
import { prisma } from "./snapshotBuilder.js";
import type { Prisma } from "@prisma/client";
import { LOAD_ORDER } from "./reportFormats.js";
import { sourceEnvironmentLocked, createSourceAdapter } from "./sourceAdapter.js";
import { getConfig, previewSourceSwitch, openIncrementalSyncLease, closeIncrementalSyncLease } from "./syncService.js";
import { openSourceSettings } from "./sourceConnectionVault.js";
import { sourceFingerprint, stageValidatedGeneration } from "./sourceGovernance.js";

export function verifyContinuity(
  active: {cursors:Array<{reportKey:string;digest:string|null;rowCount:number|null;lastSourceUpdatedAt:Date|null;reconciledAt:Date|null}>},
  target: {cursors:Array<{reportKey:string;digest:string|null;rowCount:number|null;lastSourceUpdatedAt:Date|null;reconciledAt:Date|null}>},
) {
  const previous=new Map(active.cursors.map(x=>[x.reportKey,x]));
  const next=new Map(target.cursors.map(x=>[x.reportKey,x]));
  for(const feed of LOAD_ORDER) {
    const a=previous.get(feed),b=next.get(feed);
    if(!a||!b||!a.reconciledAt||!b.reconciledAt||!a.digest||!b.digest||!/^[a-f0-9]{64}$/.test(a.digest) ||
       a.digest!==b.digest || a.rowCount==null || b.rowCount==null ||
       a.rowCount!==b.rowCount ||
       (a.lastSourceUpdatedAt?.getTime()??null)!==(b.lastSourceUpdatedAt?.getTime()??null)) {
      throw new Error(`Source ${feed} continuity is unverified or differs; cutover blocked without any data purge`);
    }
  }
}

export async function activateEquivalentSource(input:{
  targetGenerationId:string;expectedActiveGenerationId:string;
  actor:string;reason:string;confirm:string;
}) {
  if(process.env.ENABLE_GOVERNED_SOURCE_CUTOVER!=="true") throw new Error("Governed source cutover is disabled");
  const rollback=input.confirm==="RESTORE";
  if(input.confirm!=="SWITCH" && !rollback) throw new Error("Explicit SWITCH or RESTORE confirmation required");
  if(!input.actor?.trim()||!input.reason?.trim()) throw new Error("Cutover actor and reason required");
  if(sourceEnvironmentLocked()||process.env.SOURCE_SQL_PASSWORD||process.env.SOURCE_API_TOKEN) {
    throw new Error("Environment-locked source credentials must be migrated to the governed vault before cutover");
  }
  const lease=await openIncrementalSyncLease();
  if(!lease) throw new Error("Cannot cut over while source sync or full refresh is running");
  try {
    const [current,target,config,liveCursors]=await Promise.all([
      prisma.sourceGeneration.findUnique({where:{id:input.expectedActiveGenerationId},include:{cursors:true}}),
      prisma.sourceGeneration.findUnique({where:{id:input.targetGenerationId},include:{cursors:true,credentialVault:true}}),
      getConfig(),
      prisma.integrationCursor.findMany({where:{reportKey:{in:LOAD_ORDER}},select:{reportKey:true,lastSourceUpdatedAt:true}}),
    ]);
    if(!current||current.state!=="ACTIVE"||!target||(rollback ? target.state!=="RETIRED" : target.state!=="VALIDATED")||!target.validatedAt||
       !target.credentialVault||current.id===target.id) throw new Error("Invalid active or candidate source generation");
    if(sourceFingerprint(config)!==current.fingerprint) throw new Error("Active SQL connection no longer matches the expected generation");
    verifyContinuity(current,target);
    // An old source cannot be restored after new source changes without a
    // fresh reconciliation. Prevent stale rollback from dropping updates.
    for(const feed of LOAD_ORDER) {
      const activeCheckpoint=current.cursors.find(x=>x.reportKey===feed)?.lastSourceUpdatedAt;
      const liveCheckpoint=liveCursors.find(x=>x.reportKey===feed)?.lastSourceUpdatedAt;
      if((activeCheckpoint?.getTime()??null)!==(liveCheckpoint?.getTime()??null))
        throw new Error("Source cursors advanced since reconciliation; cutover requires a new proof");
    }
    const candidate=openSourceSettings(target.id,target.credentialVault);
    if(sourceFingerprint({...config,...candidate})!==target.fingerprint)
      throw new Error("Decrypted connection does not match the approved source identity");
    const preflight=await previewSourceSwitch(candidate);
    if(!preflight.ok) throw new Error("Candidate source connection failed fresh validation");
    // Source data might have advanced since it was reconciled. Recheck
    // remote source watermarks on both connections under the sync lease.
    const verifiedAt=Date.now();
    for(const cursor of [...current.cursors,...target.cursors]) {
      if(!cursor.reconciledAt || verifiedAt-cursor.reconciledAt.getTime()>60*60_000 ||
         cursor.reconciledAt.getTime()>verifiedAt)
        throw new Error("Reconciliation proof is stale; cutover blocked");
    }
    const readWatermark=(value:string|null|undefined)=>{
      if(!value)return null;
      const raw=value.trim().replace(" ","T");
      const ms=Date.parse(/(?:Z|[+-][0-9]{2}:?[0-9]{2})$/i.test(raw)?raw:raw+"Z");
      if(!Number.isFinite(ms))throw new Error("Invalid source watermark");
      return ms;
    };
    const proposed=new Map((preflight.watermarks??[]).map(row=>[row.reportKey,readWatermark(row.newest)]));
    if(proposed.size!==LOAD_ORDER.length) throw new Error("Candidate view watermarks are incomplete");
    for(const cursor of target.cursors) {
      if(proposed.get(cursor.reportKey)!==(cursor.lastSourceUpdatedAt?.getTime()??null))
        throw new Error("Candidate source changed after reconciliation");
    }
    let activeAdapter:Awaited<ReturnType<typeof createSourceAdapter>>|null=null;
    try{
      activeAdapter=await createSourceAdapter(config);
      if(!activeAdapter.watermark)throw new Error("Active source has no watermark provider");
      for(const cursor of current.cursors){
        const actual=await activeAdapter.watermark(cursor.reportKey);
        if(readWatermark(actual.newest)!==(cursor.lastSourceUpdatedAt?.getTime()??null))
          throw new Error("Active source changed after reconciliation");
      }
    }finally { await activeAdapter?.close().catch(()=>{}); }

    const changed=await prisma.$transaction(async tx=>{
      const active=await tx.sourceGeneration.findUnique({where:{id:current.id}});
      const next=await tx.sourceGeneration.findUnique({where:{id:target.id}});
      if(active?.state!=="ACTIVE"||next?.state!==(rollback?"RETIRED":"VALIDATED")) throw new Error("Concurrent source activation conflict");
      // The source lease excludes sync workers while all ten checkpoints and
      // the source credentials are swapped as one serializable transaction.
      if (candidate.sqlDialect == null) throw new Error("Source SQL dialect must be configured before cutover");
      // Values in the candidate patch may be nullable; required Prisma fields cannot be.
      const configUpdate = Object.fromEntries(Object.entries(candidate).filter(([,value]) => value !== null && value !== undefined)) as Prisma.IntegrationConfigUpdateInput;
      await tx.integrationConfig.update({where:{id:"default"},data:configUpdate});
      for (const feed of LOAD_ORDER) {
        const cursor=target.cursors.find(x=>x.reportKey===feed);
        if(!cursor) throw new Error("Incomplete source checkpoint");
        await tx.integrationCursor.upsert({
          where:{reportKey:feed},
          create:{reportKey:feed,lastSourceUpdatedAt:cursor.lastSourceUpdatedAt,lastStatus:"OK",lastNote:"Equivalent source cutover"},
          update:{lastSourceUpdatedAt:cursor.lastSourceUpdatedAt,lastStatus:"OK",lastNote:"Equivalent source cutover"},
        });
      }
      await tx.sourceGeneration.update({where:{id:current.id},data:{state:"RETIRED"}});
      await tx.sourceGeneration.update({where:{id:target.id},data:{state:"ACTIVE",activatedAt:new Date()}});
      await tx.sourceActivationAudit.create({data:{
        previousGenerationId:current.id,nextGenerationId:target.id,actor:input.actor,reason:input.reason,action:rollback?"ROLLBACK_EQUIVALENT":"ACTIVATE_EQUIVALENT",
      }});
      return {previousGenerationId:current.id,activeGenerationId:target.id,feedsPreserved:LOAD_ORDER.length};
    },{isolationLevel:"Serializable",timeout:20_000});
    return {ok:true,...changed,note:rollback?"Verified equivalent source restored atomically without data purge":"Verified equivalent source activated atomically; no dashboard data was purged or rewritten"};
  }finally{
    await closeIncrementalSyncLease(lease);
  }
}

/** Register the current live source without touching its connection or facts.
 * One-time bootstrap is needed before equivalent candidate comparison.
 */
export async function bootstrapExistingSource(input:{actor:string;reason:string;confirm:string}) {
  if(process.env.ENABLE_GOVERNED_SOURCE_CUTOVER!=="true") throw new Error("Governed cutover is disabled");
  if(input.confirm!=="BOOTSTRAP"||!input.actor.trim()||!input.reason.trim())
    throw new Error("Explicit BOOTSTRAP confirmation, actor and reason required");
  if(!process.env.SOURCE_CONNECTION_VAULT_KEY||sourceEnvironmentLocked()||
     process.env.SOURCE_SQL_PASSWORD||process.env.SOURCE_API_TOKEN)
    throw new Error("A governed credential vault without environment-locked source secrets is required");
  const lease=await openIncrementalSyncLease();
  if(!lease) throw new Error("Source synchronization is currently running");
  try {
    const config=await getConfig();
    if(!config.enabled) throw new Error("The existing source is not enabled");
    if(await prisma.sourceGeneration.findFirst({where:{state:"ACTIVE"}}))
      throw new Error("An active source generation already exists");
    const staged=await stageValidatedGeneration({});
    if(!staged.ok || !("generationId" in staged) || !staged.generationId || !("credentialsStaged" in staged) || !staged.credentialsStaged)
      throw new Error("Active source failed validation or vault registration");
    const current=await prisma.integrationCursor.findMany({where:{reportKey:{in:LOAD_ORDER}}});
    if(current.length!==LOAD_ORDER.length)
      throw new Error("All ten active integration cursors must exist before bootstrap");
    await prisma.$transaction(async tx=>{
      const fresh=await tx.sourceGeneration.findUnique({where:{id:staged.generationId}});
      if(!fresh||fresh.state!=="VALIDATED"||fresh.fingerprint!==sourceFingerprint(config))
        throw new Error("Bootstrap candidate identity changed during validation");
      for(const cursor of current){
        await tx.sourceGenerationCursor.upsert({
          where:{generationId_reportKey:{generationId:fresh.id,reportKey:cursor.reportKey}},
          create:{generationId:fresh.id,reportKey:cursor.reportKey,lastSourceUpdatedAt:cursor.lastSourceUpdatedAt},
          update:{lastSourceUpdatedAt:cursor.lastSourceUpdatedAt},
        });
      }
      await tx.sourceGeneration.update({where:{id:fresh.id},data:{state:"ACTIVE",activatedAt:new Date()}});
      await tx.sourceActivationAudit.create({data:{
        nextGenerationId:fresh.id,actor:input.actor,reason:input.reason,action:"BOOTSTRAP",
      }});
    },{isolationLevel:"Serializable",timeout:20_000});
    return {ok:true,generationId:staged.generationId,reconciliationPending:true,
      note:"Existing source registered. Historical facts and live connection unchanged; full feed reconciliation remains required before any switch."};
  }finally {await closeIncrementalSyncLease(lease);}
}
