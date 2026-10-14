// AWS Signature V4 presigned requests for private S3-compatible stores.
// No client-side secrets, no new dependencies, and no URLs retained in Neon.
import { createHmac, createHash } from "node:crypto";
import { loadSemanticStorageSettings } from "./semanticStorageSettings.js";
import type { SemanticStorageBroker } from "./semanticShadowWorker.js";

const sha=(value:string)=>createHash("sha256").update(value).digest("hex");
const hmac=(key:Buffer|string,data:string)=>createHmac("sha256",key).update(data).digest();
const encode=(x:string)=>encodeURIComponent(x).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);
function signingKey(secret:string,date:string,region:string) {
  const a=hmac("AWS4"+secret,date),b=hmac(a,region),c=hmac(b,"s3");
  return hmac(c,"aws4_request");
}
export function presignS3Request(input:{method:"GET"|"PUT";key:string;now?:Date;expirySeconds?:number},env:NodeJS.ProcessEnv=process.env):string {
  const c=loadSemanticStorageSettings(env);
  if(!input.key.startsWith("semantic/")||input.key.includes("..")||input.key.includes("//")||input.key.length>900)
    throw new Error("Invalid semantic object key");
  const expiry=input.expirySeconds??300;
  if(!Number.isInteger(expiry)||expiry<30||expiry>900) throw new Error("Invalid signed URL expiry");
  const now=input.now??new Date();
  const stamp=now.toISOString().replace(/[:-]|\.\d{3}/g,"");
  const day=stamp.slice(0,8);
  const base=new URL(c.endpoint);
  const virtualHost=c.urlStyle==="virtual-host";
  const host=virtualHost ? `${c.bucket}.${base.host}` : base.host;
  const canonicalPath=[...base.pathname.split("/").filter(Boolean),...(virtualHost?[]:[c.bucket]),...input.key.split("/")].map(encode).join("/");
  const scope=`${day}/${c.region}/s3/aws4_request`;
  const parameters:Record<string,string>={
    "X-Amz-Algorithm":"AWS4-HMAC-SHA256",
    "X-Amz-Credential":`${c.accessKeyId}/${scope}`,
    "X-Amz-Date":stamp,
    "X-Amz-Expires":String(expiry),
    "X-Amz-SignedHeaders":"host",
  };
  const query=Object.entries(parameters).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${encode(k)}=${encode(v)}`).join("&");
  const path="/"+canonicalPath;
  const canonical=`${input.method}\n${path}\n${query}\nhost:${host}\n\nhost\nUNSIGNED-PAYLOAD`;
  const signature=createHmac("sha256",signingKey(c.secretAccessKey,day,c.region)).update(`AWS4-HMAC-SHA256\n${stamp}\n${scope}\n${sha(canonical)}`).digest("hex");
  return `${base.protocol}//${host}${path}?${query}&X-Amz-Signature=${signature}`;
}
export function createSemanticStorageBroker(env:NodeJS.ProcessEnv=process.env):SemanticStorageBroker {
  loadSemanticStorageSettings(env);
  return {
    async presign({objectKey}) {
      return {putUrl:presignS3Request({method:"PUT",key:objectKey},env),
        getUrl:presignS3Request({method:"GET",key:objectKey},env)};
    },
  };
}
