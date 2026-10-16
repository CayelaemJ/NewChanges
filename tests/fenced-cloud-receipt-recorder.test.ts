import assert from "node:assert/strict";
import {createFencedCloudReceiptRecorder} from "../src/services/fencedCloudReceiptRecorder.js";
let version=0;const calls:string[]=[];
const db={query:async<T extends Record<string,unknown>>(sql:string,params:readonly unknown[])=>{
 calls.push(sql);
 if(sql.startsWith("INSERT"))return [{fence:"1",version:"0"}] as unknown as T[];
 if(sql.startsWith("UPDATE")){
  assert.equal(BigInt(String(params[4])),BigInt(version));
  version++;
  return [{version:String(version)}] as unknown as T[];
 }
 return [] as T[];
}};
const recorder=await createFencedCloudReceiptRecorder(db,"g1","employers","railway");
const hash="b".repeat(64),sample={generation:"g1",feed:"employers",snapshotId:"snapshot1",
 sha256:hash,objectKey:`semantic/staging/g1/snapshot1/employers/${hash}.json`,
 bytes:100,pageDigest:"a".repeat(64),
 cursor:{updatedAt:"2026-10-16T12:00:00Z",keys:["A"]}};
await recorder.recordReceipt(sample);
await recorder.recordReceipt({...sample,cursor:{...sample.cursor,keys:["B"]}});
assert.equal(recorder.currentVersion(),2n);
assert.equal(calls.length,3);
await assert.rejects(recorder.recordReceipt({...sample,feed:"employees"}),/outside/);
assert.equal(recorder.currentVersion(),2n);
assert.equal(recorder.publicationEnabled,false);
console.log("Cloud receipt ledger advances fenced versions only after verified receipts");
