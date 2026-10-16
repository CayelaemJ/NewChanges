// Bounded server-side HTTPS transport for the isolated S3-compatible
// Playground staging sink. Only use with URLs signed by our trusted broker.
// Never forward arbitrary user-supplied URLs to this transport.
import type {CloudStageHttp} from "./isolatedCloudPageSink.js";
import {loadSemanticStorageSettings} from "./semanticStorageSettings.js";
function ensureSigned(url:string,origin:string,objectPrefix:string){
 const parsed=new URL(url);
 if(parsed.origin!==origin||!parsed.pathname.startsWith(objectPrefix)||
    parsed.protocol!=="https:"||parsed.username||parsed.password||
    parsed.searchParams.get("X-Amz-Algorithm")!=="AWS4-HMAC-SHA256"||
    !parsed.searchParams.get("X-Amz-Signature"))
  throw new Error("HTTPS SigV4 signed object URL required");
}
export function createBoundedCloudStageHttp(timeoutMs=15000,env:NodeJS.ProcessEnv=process.env):CloudStageHttp{
 const settings=loadSemanticStorageSettings(env);
 const base=new URL(settings.endpoint);
 const expectedOrigin=settings.urlStyle==="virtual-host"
  ?base.protocol+"//"+settings.bucket+"."+base.host:base.origin;
 const keyPrefix=settings.urlStyle==="virtual-host"?"/semantic/staging/":
  "/"+settings.bucket+"/semantic/staging/";
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)
  throw new Error("Invalid cloud staging HTTP timeout");
 return {
  async put(url,body){
   ensureSigned(url,expectedOrigin,keyPrefix);
   if(!(body instanceof Uint8Array)||body.byteLength<1||body.byteLength>16*1024*1024)
    throw new Error("Invalid cloud PUT payload budget");
   const res=await fetch(url,{method:"PUT",body:Buffer.from(body),
    redirect:"error",signal:AbortSignal.timeout(timeoutMs)});
   if(!res.ok)throw new Error("Cloud staged PUT failed with status "+res.status);
  },
  async get(url,maximumBytes){
   ensureSigned(url,expectedOrigin,keyPrefix);
   if(!Number.isSafeInteger(maximumBytes)||maximumBytes<1||maximumBytes>16*1024*1024)
    throw new Error("Invalid cloud GET byte budget");
   const res=await fetch(url,{method:"GET",redirect:"error",
    signal:AbortSignal.timeout(timeoutMs)});
   if(!res.ok||!res.body)throw new Error("Cloud staged GET failed with status "+res.status);
   const declared=Number(res.headers.get("content-length")??"0");
   if(!Number.isSafeInteger(declared)||declared>maximumBytes)
    throw new Error("Cloud response exceeds declared byte budget");
   const reader=res.body.getReader();
   const chunks:Uint8Array[]=[];
   let count=0;
   try{
    while(true){
     const result=await reader.read();
     if(result.done)break;
     count+=result.value.byteLength;
     if(count>maximumBytes)throw new Error("Cloud response exceeded byte budget");
     chunks.push(result.value);
    }
   }finally{await reader.cancel().catch(()=>{});}
   const output=new Uint8Array(count);let offset=0;
   for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.byteLength;}
   return output;
  }
 };
}
