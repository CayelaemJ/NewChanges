import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {LOAD_ORDER,getFormat} from "../src/services/reportFormats.js";
import {extractTenMappedFeeds} from "../src/services/canonicalMappedStagingRunner.js";
import {createPlaygroundMappedStagingStore} from "../src/services/playgroundMappedStagingStore.js";
const catalog=LOAD_ORDER.flatMap(feed=>getFormat(feed)!.fields.filter(f=>f.required).map(f=>({
 schema:"legacy",table:feed+"_archive",column:"raw_"+f.name,dataType:"text",nullable:false
})));
const mapping={sourceGeneration:"candidateTen",feeds:LOAD_ORDER.map(feed=>({
 feed,sourceTable:"legacy."+feed+"_archive",
 columns:Object.fromEntries(getFormat(feed)!.fields.filter(f=>f.required).map(f=>[f.name,"raw_"+f.name]))
}))};
const root=await mkdtemp(join(tmpdir(),"mapped-ten-feeds-"));
try{
 const store=createPlaygroundMappedStagingStore(root);
 let calls=0;
 const done=await extractTenMappedFeeds(feed=>{
  const format=getFormat(feed)!;
  const rows=["A","B"].map(k=>Object.fromEntries(format.fields.filter(f=>f.required)
   .map(f=>[f.name,f.name==="source_updated_at"?"2026-10-16T12:00:00Z":
    f.type==="date"?"2026-10-15":f.type==="datetime"?"2026-10-16T12:00:00Z":
    f.type==="int"?1:f.type==="decimal"?"1.00":f.type==="bool"?false:
    f.type==="enum"?f.enumValues?.[0]:k])));
  return {mapping,catalog,feed,dialect:"MYSQL" as const,upperWatermark:"2026-10-16T13:00:00Z",
   reader:{snapshotId:"ten_snapshot",snapshotConsistent:true as const,
    queryReadOnly:async(_sql:string,params:readonly (string|number)[])=>{
     calls++;
     const size=Number(params[params.length-1]);
     // The first natural-key component follows the two timestamp parameters.
     // Composite-key feeds have additional bound values after it.
     const cursor=params.length>2?String(params[3]):"";
     return rows.filter(row=>String(row[format.naturalKey[0]])>cursor).slice(0,size);
    }},
   sink:store.sink,canonicalValidation:"strict" as const,pageSize:1,maxRows:3,maxBytes:4096,maxPages:4
  };
 },{maxTotalRows:30,maxTotalBytes:40960,maxTotalPages:40});
 assert.equal(done.summaries.length,10);
 assert.equal(done.summaries.reduce((n,s)=>n+s.rowsCommitted,0),20);
 assert.equal(done.publicationEnabled,false);
 for(const feed of LOAD_ORDER){
  const saved=await store.readCheckpoint("candidateTen","ten_snapshot",feed);
  assert.equal(saved?.sequence,2);
  assert.equal(saved?.cursor.keys[0],"B");
 }
 assert(calls>=20);
 console.log("All ten ordered canonical feeds staged durably with bounded mapped MySQL query projections");
}finally{await rm(root,{recursive:true,force:true});}
