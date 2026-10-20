// Validate the complete extraction before any live write. Private, disposable
// staging holds pages rather than retaining a full source feed on the JS heap.
import {mkdtemp, open, readFile, rm, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {serialize, deserialize} from "node:v8";
import {createHash,randomBytes,createCipheriv,createDecipheriv} from "node:crypto";
import {validate} from "./importParser.js";
import type {ReportFormat} from "./reportFormats.js";
import type {SourceFetchResult} from "./sourceAdapter.js";

export async function prepareSourceFeed(format:ReportFormat, pages:AsyncIterable<SourceFetchResult>,
  options:{through:Date;authoritative:boolean;maxBytes?:number;maxRows?:number} ) {
  const directory=await mkdtemp(join(tmpdir(),"efs-source-"));
  const paths:string[]=[];
  // Ephemeral key never leaves this process. A hard crash cannot leave readable
  // employee records in an orphaned temporary file.
  const key=randomBytes(32);
  const keys=new Set<string>();
  const sample:Record<string,unknown>[]=[];
  const employers=new Set<string>();
  const maxBytes=options.maxBytes??512*1024*1024;
  const maxRows=options.maxRows??1_000_000;
  let bytes=0,rowCount=0,location="source",newest:Date|null=null;
  const close=async()=>{key.fill(0);await rm(directory,{recursive:true,force:true});};
  try {
    for await(const page of pages) {
      location=page.location;
      // The adapter must also bound extraction; this assertion fences custom adapters.
      if(page.records.length>5000)throw new Error("Source page exceeds 5000-row memory budget");
      const result=validate(format,page.records);
      if(!result.ok)throw new Error(`${format.key}: source validation failed before live writes (${result.errors.length} cell errors; ${result.missingColumns.length} missing columns)`);
      for(const row of result.rows) {
        if(++rowCount>maxRows)throw new Error("Source feed exceeds configured row budget; use a smaller incremental window");
        const naturalKey=JSON.stringify(format.naturalKey.map(k=>row[k]));
        const digest=createHash("sha256").update(naturalKey).digest("base64");
        if(keys.has(digest))throw new Error(`${format.key}: duplicate natural key across source pages`);
        keys.add(digest);
        const timestamp=row.source_updated_at as Date;
        if(!options.authoritative && timestamp.getTime()>options.through.getTime()+300_000)
          throw new Error(`${format.key}: source clock is more than five minutes ahead`);
        if(timestamp>options.through)row.source_updated_at=options.through;
        const accepted=row.source_updated_at as Date;
        if(!newest||accepted>newest)newest=accepted;
        if(row.employer_ref)employers.add(String(row.employer_ref));
        // Preserve the existing MLOps assessment's first-50,000-row sample.
        if(sample.length<50_000)sample.push(row);
      }
      const encoded=serialize(result.rows);
      const iv=randomBytes(12);
      const cipher=createCipheriv("aes-256-gcm",key,iv,{authTagLength:16});
      const ciphertext=Buffer.concat([cipher.update(encoded),cipher.final()]);
      const sealed=Buffer.concat([iv,cipher.getAuthTag(),ciphertext]);
      bytes+=sealed.byteLength;
      if(bytes>maxBytes)throw new Error("Source staging exceeds disk budget; retry a smaller incremental window");
      const path=join(directory,String(paths.length));
      const handle=await open(path,"wx",0o600);
      try{await handle.writeFile(sealed);}finally{await handle.close();}
      paths.push(path);
    }
    keys.clear();
    return {rowCount,location,newest,employers,sample,close,
      async *rows():AsyncGenerator<Record<string,any>[]> {
        for(const path of paths){
          if((await stat(path)).size>maxBytes)throw new Error("Invalid source staging page");
          const sealed=await readFile(path);
          const decipher=createDecipheriv("aes-256-gcm",key,sealed.subarray(0,12),{authTagLength:16});
          decipher.setAuthTag(sealed.subarray(12,28));
          yield deserialize(Buffer.concat([decipher.update(sealed.subarray(28)),decipher.final()]));
        }
      }};
  }catch(error){await close();throw error;}
}
