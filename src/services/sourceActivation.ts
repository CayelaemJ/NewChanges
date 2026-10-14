// Fail-closed, fully audited equivalent-source cutover. This operation
// NEVER imports or purges historical facts. A different dataset needs an
// independently staged semantic generation and is not eligible for this path.
import { prisma } from "./snapshotBuilder.js";
import { LOAD_ORDER } from "./reportFormats.js";
import { sourceEnvironmentLocked } from "./sourceAdapter.js";
import { getConfig, previewSourceSwitch, openIncrementalSyncLease, closeIncrementalSyncLease } from "./syncService.js";
import { openSourceSettings } from "./sourceConnectionVault.js";
import { sourceFingerprint } from "./sourceGovernance.js";

function verifyContinuity(
  active: {cursors:Array<{reportKey:string;digest:string|null;rowCount:number|null;lastSourceUpdatedAt:Date|null}>},
  target: {cursors:Array<{reportKey:string;digest:string|null;rowCount:number|null;lastSourceUpdatedAt:Date|null}>},
) {
  const previous=new Map(active.cursors.map(x=>[x.reportKey,x]));
  const next=new Map(target.cursors.map(x=>[x.reportKey,x]));
  for(const feed of LOAD_ORDER) {
    const a=previous.get(feed),b=next.get(feed);
    if(!a||!b||!a.digest||!b.digest||!/^[a-f0-9]{64}$/.test(a.digest) ||
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
    if(rollback) {
      for(const feed of LOAD_ORDER) {
        const activeCheckpoint=current.cursors.find(x=>x.reportKey===feed)?.lastSourceUpdatedAt;
        const liveCheckpoint=liveCursors.find(x=>x.reportKey===feed)?.lastSourceUpdatedAt;
        if((activeCheckpoint?.getTime()??null)!==(liveCheckpoint?.getTime()??null))
          throw new Error("Source has advanced since cutover; rollback requires new reconciliation");
      }
    }
    const candidate=openSourceSettings(target.id,target.credentialVault);
    if(sourceFingerprint({...config,...candidate})!==target.fingerprint)
      throw new Error("Decrypted connection does not match the approved source identity");
    const preflight=await previewSourceSwitch(candidate);
    if(!preflight.ok) throw new Error("Candidate source connection failed fresh validation");
    const changed=await prisma.$transaction(async tx=>{
      const active=await tx.sourceGeneration.findUnique({where:{id:current.id}});
      const next=await tx.sourceGeneration.findUnique({where:{id:target.id}});
      if(active?.state!=="ACTIVE"||next?.state!==(rollback?"RETIRED":"VALIDATED")) throw new Error("Concurrent source activation conflict");
      // The source lease excludes sync workers while all ten checkpoints and
      // the source credentials are swapped as one serializable transaction.
      await tx.integrationConfig.update({where:{id:"default"},data:candidate});
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
