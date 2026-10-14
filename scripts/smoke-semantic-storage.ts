// Playground-only S3 smoke test: one tiny immutable object, upload and independently
// read back through S3 SigV4. Does not query or mutate the application DB.
import { randomUUID } from "node:crypto";
import { createSemanticStorageBroker } from "../src/services/semanticS3Broker.js";
import { putAndVerifySemanticObject } from "../src/services/semanticObjectVerification.js";

async function main() {
  if (process.env.SEMANTIC_STORAGE_SMOKE_TEST !== "true") {
    console.log("Storage smoke test disabled; no object will be written.");
    return;
  }
  const broker = createSemanticStorageBroker();
  const period = new Date().toISOString().slice(0, 7);
  const objectKey = `semantic/smoke/smoke/${period}/${randomUUID()}.json`;
  const content = Buffer.from(JSON.stringify({probe:"semantic-storage-v1",period}),"utf8");
  const signed = await broker.presign({objectKey,bytes:content.byteLength});
  const proof = await putAndVerifySemanticObject({putUrl:signed.putUrl,getUrl:signed.getUrl,content,maxBytes:1024});
  if (proof.bytes!==content.byteLength) throw new Error("S3 smoke test read-back mismatch");
  console.log(JSON.stringify({ok:true,objectVerified:true,bytes:proof.bytes}));
}
main().catch((error:unknown)=>{console.error("S3 storage smoke test failed:",error instanceof Error?error.message:String(error));process.exitCode=1;});
