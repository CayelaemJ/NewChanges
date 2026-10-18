import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {createFencedCloudReceiptRecorder} from "../src/services/fencedCloudReceiptRecorder.js";
import {createIsolatedCloudPageSink} from "../src/services/isolatedCloudPageSink.js";
const env={SEMANTIC_S3_ENDPOINT:"https://playground-storage.example.test",
 SEMANTIC_S3_BUCKET:"playground-test",SEMANTIC_S3_REGION:"auto",
 SEMANTIC_S3_ACCESS_KEY_ID:"dummy",SEMANTIC_S3_SECRET_ACCESS_KEY:"dummy"};
const storage=new Map<string,Uint8Array>();
let failReadback=false,version=0,receiptCount=0;
let cursor:any=null,objectKey:string|null=null,checksum:string|null=null,snapshot:string|null=null;
const http={
 async put(url:string,bytes:Uint8Array){storage.set(new URL(url).pathname,new Uint8Array(bytes));},
 async get(url:string,limit:number){
  if(failReadback)throw new Error("Cloud object unavailable");
  const bytes=storage.get(new URL(url).pathname);
  if(!bytes||bytes.byteLength>limit)throw new Error("Missing or oversized cloud page");
  return bytes;
 }
};
const db={query:async<T extends Record<string,unknown>>(sql:string,p:readonly unknown[]):Promise<T[]>=>{
 if(sql.startsWith("INSERT"))return [{fence:"1",version:"0"}] as unknown as T[];
 if(sql.startsWith("UPDATE")&&sql.includes('SET "version"')){
  assert.equal(p[0],"g1");assert.equal(p[1],"employers");
  assert.equal(Number(p[4]),version);
  if(snapshot&&snapshot!==p[5])return [];
  const next=JSON.parse(String(p[8]));
  if(cursor&&next.updatedAt<cursor.updatedAt)return [];
  if(cursor&&JSON.stringify(cursor)===JSON.stringify(next)){
   if(objectKey!==p[6]||checksum!==p[7])return [];
  }else version++;
  cursor=next;objectKey=String(p[6]);checksum=String(p[7]);snapshot=String(p[5]);
  receiptCount++;
  return [{version:String(version)}] as unknown as T[];
 }
 throw new Error("Unexpected SQL in integration test");
}};
const recorder=await createFencedCloudReceiptRecorder(db,"g1","employers","railway");
const sink=createIsolatedCloudPageSink(http,recorder.recordReceipt,env);
const rows=[{employer_ref:"A",name:"Test Employer",source_updated_at:"2026-10-16T12:00:00Z"}];
const digest=createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const input={generation:"g1",snapshotId:"snap1",feed:"employers",rows,
 after:{updatedAt:"2026-10-16T12:00:00Z",keys:["A"]},pageDigest:digest};
await sink.sink.commitPage(input);
assert.equal(recorder.currentVersion(),1n);
assert.equal(storage.size,1);
assert.equal(receiptCount,1);
await sink.sink.commitPage(input);
assert.equal(recorder.currentVersion(),1n,"exact replay must not advance CAS version");
failReadback=true;
await assert.rejects(sink.sink.commitPage({...input,after:{...input.after,keys:["B"]}}),/unavailable/);
assert.equal(recorder.currentVersion(),1n,"failed object verification cannot publish receipt");
assert.equal(receiptCount,2,"no SQL after failed readback");
assert.equal(sink.productionEnabled,false);
console.log("Cloud readback, fenced ledger, idempotent replay and outage fail-closed integration passed");
