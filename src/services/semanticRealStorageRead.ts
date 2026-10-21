// Safe, read-only verification of bytes already stored in an isolated S3 test bucket.
// Never uploads, deletes, creates buckets or exposes signed URLs/contents in logs.
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { loadSemanticStorageSettings } from "./semanticStorageSettings.js";
import { presignS3Request } from "./semanticS3Broker.js";
import { readBoundedSemanticObject } from "./semanticObjectVerification.js";

export type ExistingSemanticObjectProof = {
  objectKey:string; expectedSha256:string; expectedBytes:number;
  bucket:string; endpointHost:string;
};

export function validateExistingSemanticObjectRead(env:NodeJS.ProcessEnv):ExistingSemanticObjectProof {
  if(env.SEMANTIC_STORAGE_READ_APPROVED!=="YES_TESTING_READ_ONLY")
    throw new Error("Explicit isolated read-only storage approval required");
  const settings=loadSemanticStorageSettings(env);
  const u=new URL(settings.endpoint);
  const host=u.hostname.toLowerCase();
  if(!env.SEMANTIC_VERIFY_ALLOWED_HOST || env.SEMANTIC_VERIFY_ALLOWED_HOST.toLowerCase()!==host ||
     !host.includes(".") || isIP(host)!==0 ||
     /(^|\.)(localhost|local|internal|invalid|test)$/.test(host))
    throw new Error("Real storage read requires the exact approved public Testing endpoint host");
  // A separate test bucket is mandatory; accidentally targeting Production
  // must fail before generating a signed URL or making a network request.
  if(!/(^|[-.])(test|testing|sandbox|playground)([-.]|$)/.test(settings.bucket))
    throw new Error("Refusing to read from a bucket not identified as Testing");
  const objectKey=env.SEMANTIC_VERIFY_OBJECT_KEY??"";
  const employerId="__synthetic_semantic_e2e_20261019__";
  const generationId="__synthetic_semantic_generation_20261019__";
  const prefix="semantic/"+generationId+"/"+employerId+"/";
  if(!objectKey.startsWith(prefix) || objectKey.includes("..") || objectKey.includes("//") ||
      objectKey.length>900 || !/^[a-zA-Z0-9_\-./]+$/.test(objectKey))
    throw new Error("Read-only verification requires an existing synthetic Testing object key");
  const expectedSha256=(env.SEMANTIC_VERIFY_SHA256??"").toLowerCase();
  if(!/^[a-f0-9]{64}$/.test(expectedSha256))
    throw new Error("Read-only verification requires a SHA-256 digest");
  const expectedBytes=Number(env.SEMANTIC_VERIFY_BYTES);
  if(!Number.isSafeInteger(expectedBytes) || expectedBytes<1 || expectedBytes>8*1024*1024)
    throw new Error("Read-only verification requires an object byte count up to 8 MiB");
  return {objectKey,expectedSha256,expectedBytes,bucket:settings.bucket,endpointHost:host};
}

export async function verifyExistingSemanticObjectRead(env:NodeJS.ProcessEnv):Promise<{
  verified:true;bytes:number;sha256:string;bucket:string;readOnly:true;
}> {
  const input=validateExistingSemanticObjectRead(env);
  const signedGet=presignS3Request({method:"GET",key:input.objectKey,expirySeconds:60},env);
  const received=await readBoundedSemanticObject(signedGet,input.expectedBytes);
  if(received.byteLength!==input.expectedBytes) throw new Error("Existing semantic object length mismatch");
  const actual=createHash("sha256").update(received).digest("hex");
  if(actual!==input.expectedSha256) throw new Error("Existing semantic object checksum mismatch");
  return {verified:true,bytes:received.byteLength,sha256:actual,bucket:input.bucket,readOnly:true};
}
