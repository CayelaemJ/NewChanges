// Concrete, read-only filesystem object store for isolated Playground rehearsals.
// Production cloud storage needs a separately approved authenticated adapter.
import {open,realpath} from "node:fs/promises";
import {constants} from "node:fs";
import {resolve,sep} from "node:path";
import type {TrustedObjectReader} from "./datasetReplacementStorageReview.js";

// Bound allocations at the storage boundary, not just in manifest metadata.
// This deliberately remains a SMALL-object CI rehearsal, not a bulk-data importer.
export const MAX_PLAYGROUND_OBJECT_BYTES=64*1024*1024;
export function createPlaygroundFileObjectReader(root:string,maxBytes=MAX_PLAYGROUND_OBJECT_BYTES):TrustedObjectReader {
  if(!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>MAX_PLAYGROUND_OBJECT_BYTES)
    throw new Error("Invalid Playground object byte limit");
  const base=resolve(root);
  return async(key:string)=>{
    if(!/^staging\/[a-zA-Z0-9_-]{1,128}\/[a-f0-9]{64}\/[a-z_]+\/[a-f0-9]{64}\.json$/.test(key))
      throw new Error("Invalid staged object key");
    const path=resolve(base,key);
    if(!path.startsWith(base+sep))throw new Error("Staging key escaped Playground root");
    const realBase=await realpath(base);
    const realPath=await realpath(path);
    if(!realPath.startsWith(realBase+sep)||realPath!==path)
      throw new Error("Staged object points outside Playground root or uses a symlink");
    // O_NOFOLLOW blocks a final-component symlink swap between realpath and open.
    const handle=await open(realPath,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {
      const stat=await handle.stat();
      if(!stat.isFile())throw new Error("Staged object is not a regular file");
      if(!Number.isSafeInteger(stat.size)||stat.size<1||stat.size>maxBytes)
        throw new Error("Staged object exceeds Playground byte limit");
      // Read at most the approved size + 1, detecting growth after stat.
      const bytes=Buffer.allocUnsafe(stat.size+1);
      let offset=0;
      while(offset<bytes.length){
        const {bytesRead}=await handle.read(bytes,offset,bytes.length-offset,offset);
        if(bytesRead===0)break;
        offset+=bytesRead;
      }
      if(offset!==stat.size)throw new Error("Staged object length changed during read");
      return bytes.subarray(0,offset);
    }finally{await handle.close();}
  };
}
