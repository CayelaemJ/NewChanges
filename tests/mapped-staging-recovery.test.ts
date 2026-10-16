import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {LOAD_ORDER,getFormat} from "../src/services/reportFormats.js";
import {extractMappedFeedToStaging,type MappedFeedRun} from "../src/services/canonicalMappedStagingRunner.js";
import {createPlaygroundMappedStagingStore} from "../src/services/playgroundMappedStagingStore.js";
const catalog=LOAD_ORDER.flatMap(feed=>getFormat(feed)!.fields.filter(f=>f.required).map(f=>({
 schema:"legacy",table:feed+"_rows",column:f.name,dataType:"text",nullable:false
})));
const mapping={sourceGeneration:"gen1",feeds:LOAD_ORDER.map(feed=>({
 feed,sourceTable:"legacy."+feed+"_rows",
 columns:Object.fromEntries(getFormat(feed)!.fields.filter(f=>f.required).map(f=>[f.name,f.name]))
}))};
const rows=["A","B","C","D","E"].map(key=>({employer_ref:key,name:"Employer "+key,
 source_updated_at:"2026-10-16T12:00:00Z"}));
const root=await mkdtemp(join(tmpdir(),"mapped-recovery-"));
try {
 const store=createPlaygroundMappedStagingStore(root);
 let failOnce=true;
 const make=(after:any,sink=store.sink):MappedFeedRun=>({
  mapping,catalog,feed:"employers",dialect:"POSTGRESQL",
  upperWatermark:"2026-10-16T13:00:00Z",after,pageSize:2,maxRows:10,maxBytes:4096,maxPages:10,
  reader:{snapshotId:"snapshot1",snapshotConsistent:true,queryReadOnly:async(_sql,params)=>{
   const limit=Number(params[params.length-1]);
   const marker=params.length>2?String(params[params.length-2]):"";
   return rows.filter(row=>row.employer_ref>marker).slice(0,limit);
  }},sink
 });
 const failing={commitPage:async(input:Parameters<typeof store.sink.commitPage>[0])=>{
  if(input.after.keys[0]==="D"&&failOnce){failOnce=false;throw new Error("simulated crash");}
  await store.sink.commitPage(input);
 }};
 await assert.rejects(extractMappedFeedToStaging(make(null,failing)),/simulated crash/);
 const first=await store.readCheckpoint("gen1","snapshot1","employers");
 assert.equal(first?.sequence,1);
 assert.equal(first?.cursor.keys[0],"B");
 const resumed=await extractMappedFeedToStaging(make(first?.cursor??null));
 assert.equal(resumed.rowsCommitted,3);
 assert.equal(resumed.after?.keys[0],"E");
 const last=await store.readCheckpoint("gen1","snapshot1","employers");
 assert.equal(last?.sequence,3);
 assert.equal(last?.cursor.keys[0],"E");
 const replay=await extractMappedFeedToStaging(make(last?.cursor??null));
 assert.equal(replay.rowsCommitted,0);
 assert.equal((await store.readCheckpoint("gen1","snapshot1","employers"))?.sequence,3);
 console.log("Mapped staging crash/restart successfully resumes from durable checkpoint");
}finally{await rm(root,{recursive:true,force:true});}
