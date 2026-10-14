// Small runtime-only verification. No tsx or dev dependencies required.
import {randomUUID} from "node:crypto";
import {createSemanticStorageBroker} from "../dist/services/semanticS3Broker.js";
import {putAndVerifySemanticObject} from "../dist/services/semanticObjectVerification.js";
if(process.env.SEMANTIC_STORAGE_SMOKE_TEST!=="true" || process.env.RAILWAY_ENVIRONMENT_NAME!=="Playground and new ideas"){
  throw new Error("Refusing S3 write outside explicitly authorized Playground smoke test");
}
const period=new Date().toISOString().slice(0,7);
const objectKey=`semantic/smoke/smoke/${period}/${randomUUID()}.json`;
const content=Buffer.from(JSON.stringify({probe:"semantic-storage-v1",period}),"utf8");
const broker=createSemanticStorageBroker();
const signed=await broker.presign({objectKey,bytes:content.length});
const proof=await putAndVerifySemanticObject({putUrl:signed.putUrl,getUrl:signed.getUrl,content,maxBytes:1024});
if(proof.bytes!==content.length) throw new Error("S3 object read-back mismatch");
console.log(JSON.stringify({objectVerified:true,bytes:proof.bytes}));
