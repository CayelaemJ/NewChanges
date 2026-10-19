// Optional dedicated semantic worker. LISTEN/NOTIFY eliminates a scheduled
// worker wake delay while durable queue rows provide reconnect/retry safety.
// NOT started in Fastify; DO NOT enable without a designated, budgeted runner.
// An always-on PostgreSQL listener can prevent Neon compute autosuspension.
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { processOneShadowSemanticRefresh } from "../src/services/semanticShadowWorker.js";
import { createSemanticStorageBroker } from "../src/services/semanticS3Broker.js";
import { reconcileExpiredSemanticRefreshLeases } from "../src/services/semanticRefreshQueue.js";
import { SEMANTIC_QUEUE_WAKE_CHANNEL, semanticListenerEnabled } from "../src/services/semanticQueueWake.js";
import { prisma } from "../src/services/snapshotBuilder.js";

async function main() {
  // Guard BEFORE opening a database socket or loading private S3 credentials.
  if (!semanticListenerEnabled()) {
    console.log("Semantic event listener disabled; no database or storage connections.");
    return;
  }
  if(!process.env.DATABASE_URL) throw new Error("Dedicated semantic listener needs a configured database");
  const storage=createSemanticStorageBroker();
  const workerId="semantic-event-"+randomUUID();
  let listener:Client|null=null;
  let closed=false;
  let draining=false;
  let pending=false;
  let stoppedDueToJobError=false;
  let failedConnection=false;

  const drain=async()=>{
    if(closed||draining)return;
    draining=true;
    try{
      // A bounded pass prevents an overloaded queue from monopolising CPU.
      // Subsequent notifications and periodic sweeps start another pass.
      const started=Date.now();
      let processed=0;
      do {
        pending=false;
        await reconcileExpiredSemanticRefreshLeases();
        for(let i=0;i<5 && Date.now()-started<45_000;i++) {
          const result=await processOneShadowSemanticRefresh(workerId,storage);
          if("error" in result) {
            stoppedDueToJobError=true;
            console.error("[semantic] event worker job failed; waiting for next wake",
              result.error);
            return;
          }
          if(!result.processed)break;
          processed++;
        }
        // If work arrived during the drain, run another bounded pass.
      }while(pending&&!closed&&Date.now()-started<45_000);
      if(processed>0) console.log(JSON.stringify({worker:"semantic-event",processed}));
    }catch(error){
      stoppedDueToJobError=true;
      console.error("[semantic] event worker drain failed",error instanceof Error?error.message:String(error));
    }finally{
      draining=false;
      // A notification arriving during finalisation must not be lost.
      if(pending&&!closed&&!stoppedDueToJobError)queueMicrotask(()=>void drain());
    }
  };
  const wake=()=>{
    if(closed)return;
    pending=true;
    if(!draining){
      stoppedDueToJobError=false;
      void drain();
    }
  };
  const shutdown=async()=>{
    if(closed)return;
    closed=true;
    clearInterval(sweep);
    if(listener)await listener.end().catch(()=>{});
    // Let the current bounded job finish and release the Prisma pool.
    while(draining)await new Promise(resolve=>setTimeout(resolve,50));
    await prisma.$disconnect();
  };
  const sweep=setInterval(wake,60_000);
  try {
    listener=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10_000});
    listener.on("notification",msg=>{
      if(msg.channel===SEMANTIC_QUEUE_WAKE_CHANNEL)wake();
    });
    listener.on("error",error=>{
      if(closed)return;
      failedConnection=true;
      console.error("[semantic] listener connection failed",error.message);
      void shutdown();
    });
    listener.on("end",()=>{
      if(closed)return;
      failedConnection=true;
      console.error("[semantic] listener disconnected; restart the supervised worker");
      void shutdown();
    });
    process.once("SIGTERM",()=>void shutdown());
    process.once("SIGINT",()=>void shutdown());
    await listener.connect();
    await listener.query("LISTEN "+SEMANTIC_QUEUE_WAKE_CHANNEL);
    // Claim already-persisted jobs after process startup or a missed signal.
    wake();
    await new Promise<void>(resolve=>{
      const watch=setInterval(()=>{
        if(!closed)return;
        clearInterval(watch);
        resolve();
      },250);
    });
    if(failedConnection)process.exitCode=1;
  }finally{
    await shutdown();
  }
}
main().catch(error=>{
  console.error("Semantic event listener startup failed",error instanceof Error?error.message:String(error));
  process.exitCode=1;
});
