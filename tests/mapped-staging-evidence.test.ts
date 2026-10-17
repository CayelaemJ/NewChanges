import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createMappedStagingEvidenceSink} from "../src/services/mappedStagingEvidence.js";
let accepts=0,fail=false;
const recorder=createMappedStagingEvidenceSink({commitPage:async()=>{
 if(fail)throw Error("storage unavailable");
 accepts++;
}});
const make=(keys:string[])=>{
 const rows=keys.map(employer_ref=>({employer_ref,name:employer_ref,source_updated_at:"2026-10-17T14:00:00Z"}));
 return {generation:"candidate",snapshotId:"snapshot1",feed:"employers",rows,
  after:{updatedAt:"2026-10-17T14:00:00Z",keys:[keys[keys.length-1]]},
  pageDigest:createHash("sha256").update(JSON.stringify(rows)).digest("hex")};
};
const first=make(["A","B"]);const second=make(["C"]);
await recorder.sink.commitPage(first);
await recorder.sink.commitPage(second);
assert.equal(accepts,2);
const receipt=recorder.finish().find(x=>x.feed==="employers")!;
assert.equal(receipt.rowsCommitted,3);
assert.equal(receipt.pagesCommitted,2);
assert.equal(receipt.digestScope,"current-process-committed-pages");
const manual=createHash("sha256");
for(const row of [...first.rows,...second.rows]){
 const b=Buffer.from(JSON.stringify(row));
 const len=Buffer.alloc(4);len.writeUInt32BE(b.length);
 manual.update(len).update(b);
}
assert.equal(receipt.committedRowsSha256,manual.digest("hex"));
const empty=recorder.finish().find(x=>x.feed==="salary_advances")!;
assert.equal(empty.rowsCommitted,0);
assert.equal(empty.committedRowsSha256,createHash("sha256").digest("hex"));
fail=true;
await assert.rejects(recorder.sink.commitPage(make(["D"])),/storage unavailable/);
assert.deepEqual(recorder.finish(),recorder.finish());
assert.equal(recorder.finish().find(x=>x.feed==="employers")!.rowsCommitted,3);
fail=false;
await assert.rejects(recorder.sink.commitPage({...first,pageDigest:"f".repeat(64)}),/digest mismatch/);
await assert.rejects(recorder.sink.commitPage({...make(["D"]),snapshotId:"other_snapshot"}),/mix/);
assert.equal(accepts,2);
console.log("Committed-only staged row digest receipts: page-invariant, empty feeds, failed writes, lineage");
