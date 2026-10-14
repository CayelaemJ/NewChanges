// Explicit one-time maintenance operation. Does not start with the web app.
// Run only after enabling governed cutover and budgeting source SQL reads.
import { randomUUID } from "node:crypto";
import { reconcileEquivalentSourcePair } from "../src/services/sourceReconciliation.js";
import { prisma } from "../src/services/snapshotBuilder.js";
async function main(){
  const active=process.env.SOURCE_RECONCILE_ACTIVE_GENERATION_ID||"";
  const candidate=process.env.SOURCE_RECONCILE_CANDIDATE_GENERATION_ID||"";
  if(!active||!candidate)throw new Error("Specify both source generation IDs");
  const maxRows=Number(process.env.SOURCE_RECONCILE_MAX_ROWS||100000);
  try {
    const result=await reconcileEquivalentSourcePair({
      activeGenerationId:active,candidateGenerationId:candidate,
      actor:process.env.SOURCE_RECONCILE_ACTOR||"maintenance",
      reason:process.env.SOURCE_RECONCILE_REASON||"Controlled source continuity verification",
      confirm:"RECONCILE",maxRowsPerFeed:maxRows,
    });
    console.log(JSON.stringify(result));
  }finally {await prisma.$disconnect();}
}
main().catch(error=>{
  console.error("Source reconciliation blocked:",error?.message||String(error));
  process.exitCode=1;
});
