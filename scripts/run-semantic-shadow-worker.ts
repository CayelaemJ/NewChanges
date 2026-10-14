// Run as a one-shot, explicitly scheduled worker, NEVER from the web server.
// Cron every minute with a single job and a cheap lease bounds Neon compute.
import { randomUUID } from "node:crypto";
import { processOneShadowSemanticRefresh } from "../src/services/semanticShadowWorker.js";
import { createSemanticStorageBroker } from "../src/services/semanticS3Broker.js";
import { prisma } from "../src/services/snapshotBuilder.js";
import { reconcileExpiredSemanticRefreshLeases } from "../src/services/semanticRefreshQueue.js";

async function main() {
  if (process.env.ENABLE_SEMANTIC_SHADOW_WORKER !== "true" ||
      process.env.ENABLE_SEMANTIC_OBJECT_PUBLISH !== "true") {
    console.log("Shadow semantic worker disabled; no database or object-store work.");
    return;
  }
  const broker=createSemanticStorageBroker();
  const workerId=`shadow-${randomUUID()}`;
  try {
    await reconcileExpiredSemanticRefreshLeases();
    const result=await processOneShadowSemanticRefresh(workerId,broker);
    console.log(JSON.stringify(result));
    if ("error" in result) process.exitCode=1;
  } finally {
    await prisma.$disconnect();
  }
}
main().catch(error=>{
  console.error("Shadow semantic worker failed:",error?.message||String(error));
  process.exitCode=1;
});
