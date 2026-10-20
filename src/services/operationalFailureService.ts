import {prisma} from "./authService.js";
import {notifyAdmins} from "./automationService.js";

// Persist first; email is an additional channel and cannot erase the Admin alert.
// Do not put source connection errors, records or credentials into notifications.
export async function reportOperationalFailure(kind:"SOURCE_SYNC"|"MLOPS"|"INTERRUPTED_SYNC"|"DASHBOARD_REFRESH") {
  const message=kind==="MLOPS"?"An MLOps assessment failed. Review server diagnostics and retry the assessment."
    :kind==="DASHBOARD_REFRESH"?"Source rows were imported but dashboard recalculation failed. Review diagnostics and retry the dashboard refresh."
    :kind==="INTERRUPTED_SYNC"?"A previous source sync was interrupted. Its cursor was retained; retry the incremental sync."
    :"Source synchronization failed. Review recent syncs and import history before retrying.";
  try {
    const event=await prisma.mLOpsEvent.create({data:{
      eventType:"OPERATIONAL_FAILURE",modelKey:"operations",modelVersion:"1",status:"REVIEW",
      metadata:{reportKey:kind,findings:[{code:kind,message,action:"Review Administration and retry after correcting the cause."}],delivery:"PENDING"},
    }});
    const delivery=await notifyAdmins({subject:`empower-fin: ${kind.replaceAll("_"," ")}`,html:`<p>${message}</p><p>Open Administration for details.</p>`});
    await prisma.mLOpsEvent.update({where:{id:event.id},data:{metadata:{
      reportKey:kind,findings:[{code:kind,message,action:"Review Administration and retry after correcting the cause."}],
      delivery:delivery.emailed>0?"EMAIL_ACCEPTED":"EMAIL_NOT_SENT",emailed:delivery.emailed,
    }}});
  }catch{console.error(`[operations] ${kind}: could not persist or deliver operational alert`);}
}

// Call only while holding the global ingestion lease. No time-based guess can
// safely distinguish a slow live import from a dead process on another replica.
export async function recoverInterruptedSyncs(database=prisma,alert=reportOperationalFailure) {
  const recovered=await database.$transaction(async tx=>{
    const logs=await tx.syncLog.updateMany({where:{status:"RUNNING",finishedAt:null},data:{
      status:"FAILED",finishedAt:new Date(),note:"Process interrupted before completion. Cursor retained; safe incremental retry required.",
    }});
    if(!logs.count)return logs;
    await tx.integrationCursor.updateMany({where:{lastStatus:"RUNNING"},data:{lastStatus:"FAILED",lastNote:"Previous process interrupted; cursor retained."}});
    await tx.integrationConfig.updateMany({where:{id:"default",lastSyncStatus:"PROCESSING"},data:{lastSyncStatus:"FAILED",lastSyncNote:"Previous source sync was interrupted; retry required."}});
    await tx.importBatch.updateMany({where:{status:"VALIDATED",OR:[{filename:{startsWith:"sql-sync:"}},{filename:{startsWith:"api-sync:"}}]},data:{status:"FAILED"}});
    return logs;
  });
  if(recovered.count)await alert("INTERRUPTED_SYNC");
}
