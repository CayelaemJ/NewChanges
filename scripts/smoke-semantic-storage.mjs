// Small runtime-only verification. No tsx or dev dependencies required.
import {randomUUID} from "node:crypto";
const envName=process.env.RAILWAY_ENVIRONMENT_NAME;
const testingApproved=envName==="Testing" && process.env.TESTING_S3_SMOKE_APPROVED==="YES_I_APPROVE";
const playgroundApproved=envName==="Playground and new ideas";
if(process.env.SEMANTIC_STORAGE_SMOKE_TEST!=="true" || !(testingApproved||playgroundApproved)){
  throw new Error("Refusing object storage write outside explicitly approved isolated rehearsal");
}
if(testingApproved && !(process.env.SEMANTIC_S3_BUCKET??"").includes("testing"))
  throw new Error("Testing object smoke must target the dedicated Testing bucket");
const [{createSemanticStorageBroker},{putAndVerifySemanticObject}]=await Promise.all([
 import("../dist/services/semanticS3Broker.js"),
 import("../dist/services/semanticObjectVerification.js"),
]);
const period=new Date().toISOString().slice(0,7);
const objectKey=`semantic/smoke/${testingApproved?"testing":"smoke"}/${period}/${randomUUID()}.json`;
const content=Buffer.from(JSON.stringify({probe:"semantic-storage-v1",period}),"utf8");
const broker=createSemanticStorageBroker();
const signed=await broker.presign({objectKey,bytes:content.length});
const proof=await putAndVerifySemanticObject({putUrl:signed.putUrl,getUrl:signed.getUrl,content,maxBytes:1024});
if(proof.bytes!==content.length) throw new Error("S3 object read-back mismatch");
console.log(JSON.stringify({objectVerified:true,bytes:proof.bytes}));
