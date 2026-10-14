// One-shot Playground-only external object probe. Not part of ordinary
// dashboard requests and disabled unless explicitly enabled in the disposable
// validation environment. Never log credentials, signed URLs, or object keys.
import { randomUUID } from "node:crypto";
import { createSemanticStorageBroker } from "./semanticS3Broker.js";
import { putAndVerifySemanticObject } from "./semanticObjectVerification.js";

export async function runPlaygroundStorageProbe() {
  if(process.env.RAILWAY_ENVIRONMENT_NAME!=="Playground and new ideas" ||
     process.env.SEMANTIC_STORAGE_SMOKE_TEST!=="true") {
    throw new Error("Storage probe is restricted to explicitly enabled Playground");
  }
  const period=new Date().toISOString().slice(0,7);
  const objectKey=`semantic/smoke/smoke/${period}/${randomUUID()}.json`;
  const content=Buffer.from(JSON.stringify({probe:"semantic-storage-v1",period}),"utf8");
  const signed=await createSemanticStorageBroker().presign({objectKey,bytes:content.length});
  const proof=await putAndVerifySemanticObject({putUrl:signed.putUrl,getUrl:signed.getUrl,content,maxBytes:1024});
  if(proof.bytes!==content.length)throw new Error("Smoke probe readback byte count differs");
  return {verified:true,bytes:proof.bytes};
}
