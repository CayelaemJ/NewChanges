import assert from "node:assert/strict";
import {createIsolatedCloudPageSink} from "../src/services/isolatedCloudPageSink.js";
import {createHash} from "node:crypto";
const env={SEMANTIC_S3_ENDPOINT:"https://storage.example.test",SEMANTIC_S3_BUCKET:"testbucket",
 SEMANTIC_S3_REGION:"auto",SEMANTIC_S3_ACCESS_KEY_ID:"test",SEMANTIC_S3_SECRET_ACCESS_KEY:"testsecret"};
const objects=new Map<string,Uint8Array>(),receipts:any[]=[];
const urlKey=(url:string)=>new URL(url).pathname;
let corrupted=false;
const http={
 async put(url:string,body:Uint8Array){objects.set(urlKey(url),new Uint8Array(body));},
 async get(url:string,_max:number){const bytes=objects.get(urlKey(url));if(!bytes)throw Error("not found");
  return corrupted?new Uint8Array([1,2,3]):bytes;}
};
const store=createIsolatedCloudPageSink(http,async r=>{receipts.push(r)},env);
const rows=[{employer_ref:"A",name:"Company A",source_updated_at:"2026-10-16T12:00:00Z"}];
const input={generation:"candidate",snapshotId:"snapshot",feed:"employers",
 rows,after:{updatedAt:"2026-10-16T12:00:00Z",keys:["A"]},
 pageDigest:createHash("sha256").update(JSON.stringify(rows)).digest("hex")};
await store.sink.commitPage(input);
assert.equal(receipts.length,1);
assert(receipts[0].objectKey.includes("/employers/"));
assert.equal(receipts[0].sha256.length,64);
corrupted=true;
await assert.rejects(store.sink.commitPage({...input,after:{...input.after,keys:["B"]}}),/checksum mismatch/);
assert.equal(receipts.length,1);
await assert.rejects(store.sink.commitPage({...input,pageDigest:"a".repeat(64)}),/digest does not match/);
await assert.rejects(store.sink.commitPage({...input,generation:"../bad"}),/identity/);
const pageBytes=Buffer.byteLength(JSON.stringify({rows,after:input.after,pageDigest:input.pageDigest}));
const capped=createIsolatedCloudPageSink(http,async()=>{},env,2*1024*1024,pageBytes*2);
corrupted=false;
await capped.sink.commitPage(input);
await assert.rejects(capped.sink.commitPage(input),/network-byte budget/);
assert.throws(()=>createIsolatedCloudPageSink(http,async()=>{},env,2*1024*1024,129*1024*1024),/network budget/);
assert.throws(()=>createIsolatedCloudPageSink(http,async()=>{},env,17*1024*1024),/budget/);
console.log("Cloud staged page upload, readback integrity and fail-closed receipt tests passed");
