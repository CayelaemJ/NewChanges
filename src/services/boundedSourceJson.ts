// Enforce the byte budget while reading, including chunked HTTP responses.
export async function readSourceJson(response:Response,maxBytes=8*1024*1024):Promise<any> {
  if(Number(response.headers.get("content-length"))>maxBytes){
    await response.body?.cancel();throw new Error("API response exceeds 8 MiB; enable cursor pagination");
  }
  const reader=response.body?.getReader();
  if(!reader)throw new Error("API response has no body");
  const chunks:Uint8Array[]=[];let bytes=0;
  try {
    while(true){const next=await reader.read();if(next.done)break;
      bytes+=next.value.byteLength;
      if(bytes>maxBytes)throw new Error("API response exceeds byte budget; enable cursor pagination");
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
