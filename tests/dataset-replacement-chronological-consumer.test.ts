import assert from "node:assert/strict";
import {LOAD_ORDER} from "../src/services/reportFormats.js";
import {consumeCanonicalChronologically,consumeChronologicalFeed,type ChronologicalFeedPlan,type ChronologicalRow} from "../src/services/datasetReplacementChronologicalConsumer.js";
const source:ChronologicalRow[]=Array.from({length:5},(_,i)=>({cursor:{updatedAt:"2026-10-16T12:00:00Z",naturalKey:"k"+i},payload:{i}}));
const caps={maxRowsPerPage:2,maxTotalRows:10,maxTotalBytes:1024,maxPages:5};
function make(feed:string,events:string[]):ChronologicalFeedPlan{
 return {feed,generationId:"g1",snapshotId:"snapshot1",after:null,caps,
 readPage:async(after,limit,snapshotId)=>({snapshotId,rows:source.filter(r=>!after||r.cursor.naturalKey>after.naturalKey).slice(0,limit)}),
 commitPage:async(rows)=>{events.push(feed+":commit:"+rows.length)},
 saveCheckpoint:async(c)=>{events.push(feed+":checkpoint:"+c.naturalKey)}};
}
const events:string[]=[];
const result=await consumeChronologicalFeed(make("employees",events));
assert.equal(result.rowsCommitted,5);
assert.equal(result.pagesCommitted,3);
assert.equal(result.lastCheckpoint?.naturalKey,"k4");
assert.deepEqual(events,["employees:commit:2","employees:checkpoint:k1","employees:commit:2","employees:checkpoint:k3","employees:commit:1","employees:checkpoint:k4"]);
const blocked=make("employees",[]);
blocked.readPage=async()=>({snapshotId:"wrong",rows:source.slice(0,1)});
await assert.rejects(consumeChronologicalFeed(blocked),/snapshot/);
const reverse=make("employees",[]);
reverse.readPage=async()=>({snapshotId:"snapshot1",rows:[source[1],source[0]]});
await assert.rejects(consumeChronologicalFeed(reverse),/out of order/);
const tiny=make("employees",[]);
tiny.caps={...caps,maxTotalBytes:1};
let writes=0;tiny.commitPage=async()=>{writes++};
await assert.rejects(consumeChronologicalFeed(tiny),/byte budget/);
assert.equal(writes,0);
const failed=make("employees",[]);
let checkpoint=0;
failed.commitPage=async()=>{throw new Error("write failure")};
failed.saveCheckpoint=async()=>{checkpoint++};
await assert.rejects(consumeChronologicalFeed(failed),/write failure/);
assert.equal(checkpoint,0);
const order:string[]=[];
const all=LOAD_ORDER.map(f=>make(f,order));
const done=await consumeCanonicalChronologically(all,async feed=>{order.push(feed+":done")});
assert.equal(done.summaries.length,10);
assert.deepEqual(order.filter(x=>x.endsWith(":done")),LOAD_ORDER.map(f=>f+":done"));
await assert.rejects(consumeCanonicalChronologically([...all].reverse()),/dependency load order/);
console.log("Chronological keyset, budgets, commit/checkpoint ordering and ten-feed dependencies passed");
