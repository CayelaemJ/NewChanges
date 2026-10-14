// AWS Signature V4 presigned URLs for Railway S3-compatible buckets.
// Uses Node's built-in crypto; credentials never leave server-side memory.
import { createHmac, createHash } from "node:crypto";
import { loadSemanticStorageSettings } from "./semanticStorageSettings.js";
import type { SemanticStorageBroker } from "./semanticShadowWorker.js";

const encode=(value:string)=>encodeURIComponent(value).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());
function hmac(key:Buffer|string,data:string):Buffer { return createHmac("sha256",key).update(data).digest(); }
function signedUrl(method:"GET"|"PUT",key:string,now=new Date()):string {
 const cfg=loadSemanticStorageSettings();
 if(!/^semantic\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/\d{4}-\d{2}\/[a-zA-Z0-9_.-]+\.json$/.test(key)) throw new Error("Invalid scoped semantic object key");
 const base=new URL(cfg.endpoint);
 if(base.pathname!=="/" && base.pathname!=="") throw new Error("Semantic storage endpoint must not contain a path");
 const time=now.toISOString().replace(/[:-]|\.\d{3}/g,"");
 const date=time.slice(0,8);
 const scope=`${date}/${cfg.region}/s3/aws4_request`;
 const objectPath="/"+[cfg.bucket,...key.split("/")].map(encode).join("/");
 const params=[
  ["X-Amz-Algorithm","AWS4-HMAC-SHA256"],
  ["X-Amz-Credential",`${cfg.accessKeyId}/${scope}`],
  ["X-Amz-Date",time],
  ["X-Amz-Expires","300"],
  ["X-Amz-SignedHeaders","host"],
 ];
 const query=params.map(([k,v])=>`${encode(k)}=${encode(v)}`).sort().join("&");
 const canonicalHeaders=`host:${base.host.toLowerCase()}\n`;
 const canonical=[method,objectPath,query,canonicalHeaders,"host","UNSIGNED-PAYLOAD"].join("\n");
 const digest=createHash("sha256").update(canonical).digest("hex");
 const toSign=["AWS4-HMAC-SHA256",time,scope,digest].join("\n");
 const kDate=hmac("AWS4"+cfg.secretAccessKey,date);
 const kRegion=hmac(kDate,cfg.region);
 const kService=hmac(kRegion,"s3");
 const signature=createHmac("sha256",hmac(kService,"aws4_request")).update(toSign).digest("hex");
 return `${base.origin}${objectPath}?${query}&X-Amz-Signature=${signature}`;
}
export function createRailwaySemanticStorageBroker():SemanticStorageBroker {
 // Validate env on startup without leaking credential values.
 loadSemanticStorageSettings();
 return {async presign({objectKey,bytes}) {
   if (!Number.isSafeInteger(bytes) || bytes<1 || bytes>8*1024*1024) throw new Error("Semantic object exceeds storage limit");
   return {putUrl:signedUrl("PUT",objectKey),getUrl:signedUrl("GET",objectKey)};
 }};
}
