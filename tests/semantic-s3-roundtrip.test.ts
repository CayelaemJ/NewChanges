import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { createSemanticStorageBroker } from "../src/services/semanticS3Broker.js";
import { putAndVerifySemanticObject } from "../src/services/semanticObjectVerification.js";

// Entirely local S3 HTTPS request emulator. It verifies the *independently*
// reconstructed AWS Signature V4 canonical request before accepting PUT/GET.
// Neither external credentials nor network calls are used by this test.
const env = {
  SEMANTIC_S3_ENDPOINT:"https://object-store.example.invalid",
  SEMANTIC_S3_BUCKET:"semantic-testing",
  SEMANTIC_S3_REGION:"eu-west-1",
  SEMANTIC_S3_ACCESS_KEY_ID:"SYNTHETIC_ACCESS_ONLY",
  SEMANTIC_S3_SECRET_ACCESS_KEY:"SYNTHETIC_SECRET_ONLY",
} as NodeJS.ProcessEnv;

function sign(key:Uint8Array|string, message:string) {
  return createHmac("sha256",key).update(message).digest();
}
function expectedSignature(method:string,url:URL) {
  const query=new URLSearchParams(url.searchParams);
  const supplied=query.get("X-Amz-Signature");
  assert.match(supplied??"",/^[a-f0-9]{64}$/);
  query.delete("X-Amz-Signature");
  assert.equal(query.get("X-Amz-Algorithm"),"AWS4-HMAC-SHA256");
  assert.equal(query.get("X-Amz-SignedHeaders"),"host");
  const date=query.get("X-Amz-Date")??"";
  assert.match(date,/^\d{8}T\d{6}Z$/);
  const credential=query.get("X-Amz-Credential")??"";
  const [access,day,region,service,terminator]=credential.split("/");
  assert.equal(access,env.SEMANTIC_S3_ACCESS_KEY_ID);
  assert.equal(region,env.SEMANTIC_S3_REGION);
  assert.equal(service,"s3");
  assert.equal(terminator,"aws4_request");
  assert.equal(day,date.slice(0,8));
  const expires=Number(query.get("X-Amz-Expires"));
  assert(expires>=30 && expires<=900);
  // AWS query parameter keys and values are percent encoded in sorted order.
  const encode=(value:string)=>encodeURIComponent(value).replace(/[!'()*]/g,
    x=>"%"+x.charCodeAt(0).toString(16).toUpperCase());
  const canonicalQuery=[...query.entries()]
    .sort(([a],[b])=>a.localeCompare(b))
    .map(([key,val])=>encode(key)+"="+encode(val)).join("&");
  const canonical=[method,url.pathname,canonicalQuery,
    "host:"+url.host+"\n","host","UNSIGNED-PAYLOAD"].join("\n");
  const scope=[day,region,"s3","aws4_request"].join("/");
  const key=sign("AWS4"+env.SEMANTIC_S3_SECRET_ACCESS_KEY!,day);
  const kRegion=sign(key,region);
  const kService=sign(kRegion,"s3");
  const signingKey=sign(kService,"aws4_request");
  const hashed=createHash("sha256").update(canonical).digest("hex");
  return {
    supplied,
    expected:createHmac("sha256",signingKey)
      .update(["AWS4-HMAC-SHA256",date,scope,hashed].join("\n")).digest("hex"),
  };
}

const actualFetch=globalThis.fetch;
let stored:Uint8Array|null=null;
let corrupted=false;
let puts=0;
let gets=0;
globalThis.fetch=async (input,init)=>{
  const url=new URL(String(input));
  assert.equal(url.hostname,"object-store.example.invalid");
  assert.equal(url.pathname,"/semantic-testing/semantic/synthetic/gen/2026-10/v1.json");
  const method=init?.method??"GET";
  const signature=expectedSignature(method,url);
  if(signature.expected!==signature.supplied) return new Response("Signature mismatch",{status:403});
  if(method==="PUT") {
    assert.equal(init?.headers && (init.headers as Record<string,string>)["content-type"],
      "application/octet-stream");
    stored=new Uint8Array(init?.body as Uint8Array);
    puts++;
    return new Response(null,{status:200});
  }
  assert.equal(method,"GET");
  gets++;
  if(!stored) return new Response("Not found",{status:404});
  const result=corrupted?new TextEncoder().encode("tampered bytes"):stored;
  return new Response(result,{status:200,headers:{"content-length":String(result.length)}});
};
try {
  const broker=createSemanticStorageBroker(env);
  const body=new TextEncoder().encode('{"schemaVersion":"semantic-shadow-v1","score":42}');
  const signed=await broker.presign({
    objectKey:"semantic/synthetic/gen/2026-10/v1.json",bytes:body.length,
  });
  assert.notEqual(signed.putUrl,signed.getUrl,"S3 signatures are method-scoped");
  const first=await putAndVerifySemanticObject({
    putUrl:signed.putUrl,getUrl:signed.getUrl,content:body,
  });
  assert.equal(first.bytes,body.length);
  assert.equal(first.sha256,createHash("sha256").update(body).digest("hex"));
  assert.equal(puts,1);
  assert.equal(gets,1);
  const forged=new URL(signed.getUrl);
  forged.searchParams.set("X-Amz-Expires","800");
  await assert.rejects(putAndVerifySemanticObject({
    putUrl:signed.putUrl,getUrl:forged.toString(),content:body,
  }),/Object storage response: 403/,"Tampered presigned GET must fail closed");
  corrupted=true;
  await assert.rejects(putAndVerifySemanticObject({
    putUrl:signed.putUrl,getUrl:signed.getUrl,content:body,
  }),/integrity check failed/,"Corrupted readback must reject publication proof");
  assert.equal(puts,3);
  console.log("Independent SigV4 verification, PUT/GET readback and tamper tests passed without external storage");
} finally {
  globalThis.fetch=actualFetch;
}
