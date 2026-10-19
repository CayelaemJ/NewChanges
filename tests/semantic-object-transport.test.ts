import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { putAndVerifySemanticObject } from "../src/services/semanticObjectVerification.js";

// In-memory HTTPS transport rehearsal. No Railway account, paid bucket,
// database writes, network egress, or external credentials are involved.
const realFetch=globalThis.fetch;
const original=new TextEncoder().encode('{"score":72,"period":"2026-10"}');
let stored:Uint8Array|null=null;
let tamper=false;
let uploaded=0;
globalThis.fetch=async (input,init)=>{
  const url=String(input);
  assert(url.startsWith("https://testing-storage.example.invalid/semantic/"));
  if(init?.method==="PUT"){
    stored=new Uint8Array(init.body as Uint8Array);
    uploaded++;
    return new Response(null,{status:200});
  }
  assert.equal(init?.method,"GET");
  if(!stored) return new Response(null,{status:404});
  const bytes=tamper?new TextEncoder().encode("corrupted"):stored;
  return new Response(bytes,{status:200,headers:{"content-length":String(bytes.length)}});
};
try {
  const args={putUrl:"https://testing-storage.example.invalid/semantic/fixture/put",
    getUrl:"https://testing-storage.example.invalid/semantic/fixture/get",content:original};
  const proof=await putAndVerifySemanticObject(args);
  assert.equal(proof.bytes,original.byteLength);
  assert.equal(proof.sha256,createHash("sha256").update(original).digest("hex"));
  assert.equal(uploaded,1);
  tamper=true;
  await assert.rejects(putAndVerifySemanticObject(args),/integrity check failed/);
  assert.equal(uploaded,2);
  await assert.rejects(putAndVerifySemanticObject({...args,getUrl:"http://localhost/semantic/fixture/get"}),/HTTPS presigned URL/);
  await assert.rejects(putAndVerifySemanticObject({...args,content:new Uint8Array(0)}),/Invalid semantic object length/);
} finally {
  globalThis.fetch=realFetch;
}
console.log("Provider-neutral semantic object PUT, GET, digest and fail-closed verification passed");
