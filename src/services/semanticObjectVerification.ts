// Provider-independent externally durable object verification using short-lived
// presigned HTTPS URLs supplied by a trusted server-side storage credential broker.
// These URLs must never be sent to the browser or stored in Neon.
import { createHash } from "node:crypto";

export interface StorageProof { sha256:string; bytes:number; verifiedAt:string }
function ensureStorageUrl(value:string):URL {
  const url=new URL(value);
  if(url.protocol!=="https:" || url.username || url.password || url.hash) throw new Error("External storage requires an authenticated HTTPS presigned URL");
  return url;
}
async function fetchBounded(url:string, init:RequestInit, maxBytes:number) {
  ensureStorageUrl(url);
  const res=await fetch(url,{...init,redirect:"error",signal:AbortSignal.timeout(30_000)});
  if(!res.ok) throw new Error(`Object storage response: ${res.status}`);
  const advertised=Number(res.headers.get("content-length")||0);
  if(advertised>maxBytes) throw new Error("External storage object exceeds byte limit");
  if (!res.body) throw new Error("Storage response was empty");
  const reader=res.body.getReader();
  const chunks:Uint8Array[]=[];
  let bytes=0;
  try {
    while(true) {
      const {done,value}=await reader.read();
      if(done) break;
      bytes+=value.byteLength;
      if(bytes>maxBytes) {
        await reader.cancel().catch(()=>{});
        throw new Error("External storage object exceeds byte limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const content=new Uint8Array(bytes);
  let offset=0;
  for(const chunk of chunks) {content.set(chunk,offset);offset+=chunk.byteLength;}
  return content;
}

// Upload once, then independently GET the bytes back. Some S3-compatible
// stores may return success before a read-after-write verification succeeds.
export async function putAndVerifySemanticObject(input:{
  putUrl:string;getUrl:string;content:Uint8Array;maxBytes?:number;
}):Promise<StorageProof> {
  const maxBytes=input.maxBytes ?? 8*1024*1024;
  if(maxBytes<1 || maxBytes>32*1024*1024) throw new Error("Invalid semantic object size limit");
  if(input.content.byteLength===0 || input.content.byteLength>maxBytes) throw new Error("Invalid semantic object length");
  ensureStorageUrl(input.putUrl); ensureStorageUrl(input.getUrl);
  const expected=createHash("sha256").update(input.content).digest("hex");
  const response=await fetch(input.putUrl,{
    method:"PUT",body:Buffer.from(input.content),redirect:"error",signal:AbortSignal.timeout(30_000),
    headers:{"content-type":"application/octet-stream"},
  });
  if(!response.ok) throw new Error(`Storage upload failed: ${response.status}`);
  const persisted=await fetchBounded(input.getUrl,{method:"GET"},maxBytes);
  const actual=createHash("sha256").update(persisted).digest("hex");
  if(actual!==expected || persisted.byteLength!==input.content.byteLength) throw new Error("Read-after-write semantic object integrity check failed");
  return {sha256:actual,bytes:persisted.byteLength,verifiedAt:new Date().toISOString()};
}
