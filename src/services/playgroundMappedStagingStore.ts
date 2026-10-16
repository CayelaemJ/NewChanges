// Isolated filesystem Playground staging sink, NOT production object storage.
// Each immutable page is written first; only a fully fsynced page can be
// referenced by an atomically replaced checkpoint. A crash leaves at most an
// unreferenced page, never a checkpoint referring to incomplete bytes.
// Single writer per (generation,snapshot,feed) required; no distributed lease.
import {createHash} from "node:crypto";
import {mkdir,open,readFile,rename,realpath,unlink} from "node:fs/promises";
import {constants} from "node:fs";
import {join,resolve,sep} from "node:path";
import type {MappedStagingSink} from "./canonicalMappedStagingRunner.js";
import type {KeysetCursor} from "./datasetReplacementKeysetSql.js";

const id=/^[A-Za-z0-9_-]{1,128}$/;
const sha=/^[0-9a-f]{64}$/;
const hash=(value:Buffer|string)=>createHash("sha256").update(value).digest("hex");
export interface PlaygroundCheckpoint{
 generation:string;snapshotId:string;feed:string;sequence:number;
 cursor:KeysetCursor;pageFile:string;contentHash:string;pageDigest:string;
 priorCheckpointHash:string|null;
}
function folder(root:string,generation:string,snapshotId:string,feed:string){
 if(![generation,snapshotId,feed].every(x=>id.test(x)))throw new Error("Invalid staging identity");
 return join(resolve(root),generation,snapshotId,feed);
}
async function atomicWrite(file:string,bytes:Buffer){
 const tmp=file+"."+process.pid+"."+hash(bytes).slice(0,16)+".tmp";
 const handle=await open(tmp,"wx",0o600);
 try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
 try{await rename(tmp,file);}catch(error){await unlink(tmp).catch(()=>{});throw error;}
 const dir=await open(resolve(file,".."),"r");
 try{await dir.sync();}finally{await dir.close();}
}
async function readCheckpointFile(file:string):Promise<PlaygroundCheckpoint|null>{
 let raw:Buffer;
 try{raw=await readFile(file);}catch(e:any){if(e?.code==="ENOENT")return null;throw e;}
 if(raw.byteLength>16*1024)throw new Error("Checkpoint exceeds safety size");
 const entry=JSON.parse(raw.toString("utf8")) as PlaygroundCheckpoint;
 if(!entry||!Number.isSafeInteger(entry.sequence)||entry.sequence<1||
  !sha.test(entry.contentHash)||!sha.test(entry.pageDigest)||
  !id.test(entry.generation)||!id.test(entry.snapshotId)||!id.test(entry.feed)||
  typeof entry.pageFile!=="string"||!/^[0-9a-f]{64}\.json$/.test(entry.pageFile))
  throw new Error("Malformed Playground checkpoint");
 return entry;
}
export function createPlaygroundMappedStagingStore(root:string,maximumPageBytes=2*1024*1024){
 if(!Number.isSafeInteger(maximumPageBytes)||maximumPageBytes<1||
   maximumPageBytes>16*1024*1024)throw new Error("Invalid Playground staging object limit");
 const base=resolve(root);
 async function read(generation:string,snapshotId:string,feed:string){
  const dir=folder(base,generation,snapshotId,feed);
  const checkpoint=await readCheckpointFile(join(dir,"checkpoint.json"));
  if(!checkpoint)return null;
  if(checkpoint.generation!==generation||checkpoint.snapshotId!==snapshotId||
   checkpoint.feed!==feed)throw new Error("Checkpoint lineage mismatch");
  const page=await readFile(join(dir,checkpoint.pageFile));
  if(page.byteLength>maximumPageBytes||hash(page)!==checkpoint.contentHash)
   throw new Error("Committed staging page corrupted or exceeds byte budget");
  const data=JSON.parse(page.toString("utf8"));
  if(!data||data.pageDigest!==checkpoint.pageDigest||
   JSON.stringify(data.after)!==JSON.stringify(checkpoint.cursor))
   throw new Error("Committed staging page and checkpoint disagree");
  return checkpoint;
 }
 const sink:MappedStagingSink={
  async commitPage(input){
   const {generation,snapshotId,feed,rows,after,pageDigest}=input;
   if(!sha.test(pageDigest)||!Array.isArray(rows)||rows.length<1||rows.length>1000)
    throw new Error("Invalid staged page evidence");
   const dir=folder(base,generation,snapshotId,feed);
   await mkdir(dir,{recursive:true,mode:0o700});
   const realDir=await realpath(dir),realBase=await realpath(base);
   if(!realDir.startsWith(realBase+sep))throw new Error("Staging directory escaped root");
   const previous=await read(generation,snapshotId,feed);
   if(previous&&JSON.stringify(previous.cursor)===JSON.stringify(after)){
    if(previous.pageDigest===pageDigest)return; // Idempotent retry after crash.
    throw new Error("Conflicting page for committed checkpoint");
   }
   if(hash(JSON.stringify(rows))!==pageDigest)
    throw new Error("Playground staged page digest does not match rows");
   const encoded=Buffer.from(JSON.stringify({rows,after,pageDigest}),"utf8");
   if(encoded.byteLength>maximumPageBytes)throw new Error("Staging object byte budget exceeded");
   const contentHash=hash(encoded),pageFile=contentHash+".json",path=join(dir,pageFile);
   // Immutable content-addressed page. A failed write cannot advance a cursor.
   try{
    // An orphan from a prior interrupted attempt is never trusted on name alone.
    const existingFile=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try{
     const info=await existingFile.stat();
     if(!info.isFile()||info.size>maximumPageBytes)
      throw new Error("Untrusted or oversized prior staging object");
     const existing=await existingFile.readFile();
     if(existing.length!==encoded.length||hash(existing)!==contentHash)
      throw new Error("Corrupted prior staging object");
    }finally{await existingFile.close();}
   }catch(e:any){
    if(e?.code!=="ENOENT")throw e;
    await atomicWrite(path,encoded);
   }
   const checkpoint:PlaygroundCheckpoint={
    generation,snapshotId,feed,sequence:(previous?.sequence??0)+1,
    cursor:after,pageFile,contentHash,pageDigest,
    priorCheckpointHash:previous?hash(JSON.stringify(previous)):null,
   };
   await atomicWrite(join(dir,"checkpoint.json"),Buffer.from(JSON.stringify(checkpoint)));
  }
 };
 return {sink,readCheckpoint:read,productionEnabled:false as const};
}
