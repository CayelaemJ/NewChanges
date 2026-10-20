import assert from "node:assert/strict";
import {recoverInterruptedSyncs} from "../src/services/operationalFailureService.js";
let count=2;const calls:Array<{model:string;args:any}>=[];let alerts=0;
const tx=Object.fromEntries(["syncLog","integrationCursor","integrationConfig","importBatch"].map(model=>[model,{
  updateMany:async(args:any)=>{calls.push({model,args});return {count:model==="syncLog"?count:1};},
}]));
const db={$transaction:async(callback:any)=>callback(tx)};
await recoverInterruptedSyncs(db as any,async kind=>{assert.equal(kind,"INTERRUPTED_SYNC");alerts++;});
assert.equal(alerts,1);assert.equal(calls.length,4);
assert.equal(calls[0].args.data.status,"FAILED");
assert.equal(calls[1].args.data.lastSourceUpdatedAt,undefined,"Recovery must retain source checkpoint");
assert.deepEqual(calls[3].args.where.OR,[{filename:{startsWith:"sql-sync:"}},{filename:{startsWith:"api-sync:"}}]);
count=0;calls.length=0;
await recoverInterruptedSyncs(db as any,async()=>{alerts++;});
assert.equal(calls.length,1);assert.equal(alerts,1,"No alert flood on clean restarts");
console.log("Interrupted sync recovery passed: transactional status repair, cursor preservation and no duplicate alerts");
