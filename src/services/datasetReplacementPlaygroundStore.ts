// Concrete, read-only filesystem object store for isolated Playground rehearsals.
// Production cloud storage needs a separately approved authenticated adapter.
import {readFile,realpath} from "node:fs/promises";
import {resolve,sep} from "node:path";
import type {TrustedObjectReader} from "./datasetReplacementStorageReview.js";
export function createPlaygroundFileObjectReader(root:string):TrustedObjectReader {
  const base=resolve(root);
  return async(key:string)=>{
    // Reject traversal, absolute paths, escaped separators and non-staging keys.
    if(!/^staging\/[a-zA-Z0-9_-]{1,128}\/[a-f0-9]{64}\/[a-z_]+\/[a-f0-9]{64}\.json$/.test(key))
      throw new Error("Invalid staged object key");
    const path=resolve(base,key);
    if(!path.startsWith(base+sep))throw new Error("Staging key escaped Playground root");
    const realBase=await realpath(base);
    const realPath=await realpath(path);
    if(!realPath.startsWith(realBase+sep))throw new Error("Staged object points outside Playground root");
    return readFile(realPath);
  };
}
