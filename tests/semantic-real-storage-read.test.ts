import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {
  validateExistingSemanticObjectRead,verifyExistingSemanticObjectRead,
} from "../src/services/semanticRealStorageRead.js";

const contents=new TextEncoder().encode('{"synthetic":true,"wellness":{"score":38}}');
const key="semantic/__synthetic_semantic_generation_20261019__/__synthetic_semantic_e2e_20261019__/2026-10/fixture.json";
const env={
  SEMANTIC_S3_ENDPOINT:"https://testing-storage.example.com",
  SEMANTIC_S3_BUCKET:"semantic-testing",
  SEMANTIC_S3_REGION:"eu-west-1",
  SEMANTIC_S3_ACCESS_KEY_ID:"FAKE_READ_ONLY_KEY",
  SEMANTIC_S3_SECRET_ACCESS_KEY:"FAKE_READ_ONLY_SECRET",
  SEMANTIC_STORAGE_READ_APPROVED:"YES_TESTING_READ_ONLY",
  SEMANTIC_VERIFY_ALLOWED_HOST:"testing-storage.example.com",
  SEMANTIC_VERIFY_OBJECT_KEY:key,
  SEMANTIC_VERIFY_SHA256:createHash("sha256").update(contents).digest("hex"),
  SEMANTIC_VERIFY_BYTES:String(contents.length),
} as NodeJS.ProcessEnv;
const refuse=(overrides:Record<string,string|undefined>,reason:RegExp)=>{
  const candidate={...env,...overrides};
  assert.throws(()=>validateExistingSemanticObjectRead(candidate),reason);
};
refuse({SEMANTIC_STORAGE_READ_APPROVED:"NO"},/approval/);
refuse({SEMANTIC_S3_BUCKET:"semantic-production"},/identified as Testing/);
refuse({SEMANTIC_VERIFY_ALLOWED_HOST:"other.example.com"},/approved public Testing endpoint/);
refuse({SEMANTIC_S3_ENDPOINT:"https://localhost",SEMANTIC_VERIFY_ALLOWED_HOST:"localhost"},/approved public Testing endpoint/);
refuse({SEMANTIC_VERIFY_OBJECT_KEY:"semantic/production/employer/2026-10/x.json"},/synthetic Testing object key/);
refuse({SEMANTIC_VERIFY_OBJECT_KEY:key+"/../other.json"},/synthetic Testing object key/);
refuse({SEMANTIC_VERIFY_SHA256:"invalid"},/SHA-256/);
refuse({SEMANTIC_VERIFY_BYTES:"9000000"},/byte count/);
assert.equal(validateExistingSemanticObjectRead(env).objectKey,key);

const old=globalThis.fetch;
let corrupt=false;
let calls=0;
globalThis.fetch=async (input,init)=>{
  calls++;
  const url=new URL(String(input));
  assert.equal(url.hostname,"testing-storage.example.com");
  assert.equal(url.pathname,"/semantic-testing/"+key);
  assert.equal(init?.method,"GET","Read-only verification must never issue uploads or deletes");
  assert.match(url.searchParams.get("X-Amz-Signature")??"",/^[a-f0-9]{64}$/);
  const received=corrupt ? new TextEncoder().encode("bad data".padEnd(contents.length,"!")) : contents;
  return new Response(received,{status:200,headers:{"content-length":String(received.length)}});
};
try {
  const proof=await verifyExistingSemanticObjectRead(env);
  assert.equal(proof.verified,true);
  assert.equal(proof.readOnly,true);
  assert.equal(proof.sha256,env.SEMANTIC_VERIFY_SHA256);
  assert.equal(calls,1);
  corrupt=true;
  await assert.rejects(verifyExistingSemanticObjectRead(env),/checksum mismatch/);
  assert.equal(calls,2);
}finally{
  globalThis.fetch=old;
}
console.log("Read-only real-storage verification guards, signed GET and SHA-256 checks passed using an offline HTTPS emulator");
