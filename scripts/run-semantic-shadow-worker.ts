// Run as a one-shot, explicitly scheduled worker, NEVER from the web server.
// One bounded drain per scheduled run limits Neon compute and queue lag.
import { randomUUID } from "node:crypto";
import { processOneShadowSemanticRefresh } from "../src/services/semanticShadowWorker.js";
import { createSemanticStorageBroker } from "../src/services/semanticS3Broker.js";
import { prisma } from "../src/services/snapshotBuilder.js";
import { reconcileExpiredSemanticRefreshLeases } from "../src/services/semanticRefreshQueue.js";

async function main() {
  if (process.env.ENABLE_SEMANTIC_SHADOW_WORKER !== "true" ||
      process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH !== "true" ||
      process.env.ENABLE_SEMANTIC_RECOMPUTE !== "true") {
    console.log("Shadow semantic worker disabled; no database or object-store work.");
    return;
  }
  const broker=createSemanticStorageBroker();
  const workerId=`shadow-${randomUUID()}`;
  try {
    await reconcileExpiredSemanticRefreshLeases();
    // Drain a small backlog without starting new jobs once the run budget expires.
    // Each claimed job has its own 180s lease; max runtime of an individual
    // score rebuild is governed separately by the database and worker lease.
    const started=Date.now();
    const maxJobs=5;
    const maxStartWindowMs=45_000;
    for(let i=0;i<maxJobs && Date.now()-started<maxStartWindowMs;i++){
      const result=await processOneShadowSemanticRefresh(workerId,broker);
      console.log(JSON.stringify(result));
      if("error" in result){process.exitCode=1;break;}
      if(!result.processed)break;
    }
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(error=>{
  console.error("Shadow semantic worker failed:",error?.message||String(error));
  process.exitCode=1;
});
