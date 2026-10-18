import assert from "node:assert/strict";
import {mkdtemp,writeFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {buildApprovedRehearsalInput} from "../scripts/run-approved-mapped-rehearsal.js";
import {LOAD_ORDER,getFormat} from "../src/services/reportFormats.js";
const dir=await mkdtemp(join(tmpdir(),"rehearsal-cli-"));
try{
 const mapping={sourceGeneration:"candidate1",feeds:LOAD_ORDER.map(feed=>({
  feed,sourceTable:"legacy."+feed,
  columns:Object.fromEntries(getFormat(feed)!.fields.filter(f=>f.required).map(f=>[f.name,f.name]))
 }))};
 const path=join(dir,"mapping.json");
 await writeFile(path,JSON.stringify(mapping));
 const env={RAILWAY_ENVIRONMENT_NAME:"Testing",PLAYGROUND_MAPPED_SOURCE_APPROVED:"yes",
  PLAYGROUND_MYSQL_HOST:"mysql.example.test",PLAYGROUND_MYSQL_DATABASE:"legacy",
  PLAYGROUND_MYSQL_USER:"readonly",PLAYGROUND_MYSQL_PASSWORD:"test",
  PLAYGROUND_SOURCE_WATERMARK:"2026-10-16T16:00:00Z"};
 const input=await buildApprovedRehearsalInput([path],env);
 assert.equal(input.mapping.feeds.length,10);
 assert.equal(input.approvedForPlayground,true);
 await assert.rejects(buildApprovedRehearsalInput([path],{...env,
   RAILWAY_ENVIRONMENT_NAME:"Production"}),/restricted/);
 await assert.rejects(buildApprovedRehearsalInput([path],{...env,
   PLAYGROUND_MAPPED_SOURCE_APPROVED:"no"}),/approval/);
 await assert.rejects(buildApprovedRehearsalInput([path],{...env,
   PLAYGROUND_MYSQL_USER:"root"}),/read-only/);
 await assert.rejects(buildApprovedRehearsalInput([]),/Expected exactly one/);
 await writeFile(path,"not json");
 await assert.rejects(buildApprovedRehearsalInput([path],env),/malformed/);
 console.log("Operator rehearsal CLI refuses production, root sources and unapproved manifests");
}finally{await rm(dir,{recursive:true,force:true});}
