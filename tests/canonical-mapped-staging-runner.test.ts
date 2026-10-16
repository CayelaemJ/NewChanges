import assert from "node:assert/strict";
import {LOAD_ORDER,getFormat} from "../src/services/reportFormats.js";
import {extractMappedFeedToStaging,extractTenMappedFeeds} from "../src/services/canonicalMappedStagingRunner.js";
import type {MappedFeedRun} from "../src/services/canonicalMappedStagingRunner.js";
const catalog=LOAD_ORDER.flatMap(feed=>getFormat(feed)!.fields.filter(f=>f.required).map(f=>({
 schema:"legacy",table:feed+"_archive",column:f.name==="source_updated_at"?"last_changed":"raw_"+f.name,
 dataType:"varchar",nullable:false
})));
const mapping={sourceGeneration:"candidate_1",feeds:LOAD_ORDER.map(feed=>({
 feed,sourceTable:"legacy."+feed+"_archive",
 columns:Object.fromEntries(getFormat(feed)!.fields.filter(f=>f.required).map(f=>
  [f.name,f.name==="source_updated_at"?"last_changed":"raw_"+f.name]))
}))};
const commits:string[]=[];
const rowFor=(feed:string,i:number)=>Object.fromEntries(getFormat(feed)!.fields.filter(f=>f.required)
 .map(f=>[f.name,f.name==="source_updated_at"?"2026-10-16T12:00:00Z":"k"+i]));
function plan(feed:string):MappedFeedRun {
 let read=0;
 return {mapping,catalog,feed,dialect:"POSTGRESQL",upperWatermark:"2026-10-16T14:00:00Z",
 reader:{snapshotId:"snap_1",snapshotConsistent:true,
  queryReadOnly:async(_sql,params)=>{
   assert(!String(_sql).includes("SELECT *"));
   const limit=Number(params[params.length-1]);
   const start=read;read+=limit;
   return [0,1,2].slice(start,start+limit).map(i=>rowFor(feed,i));
  }},
 sink:{commitPage:async p=>{commits.push(p.feed+":"+p.rows.length);assert.equal(p.snapshotId,"snap_1");}},
 maxRows:10,maxBytes:10_000,pageSize:2,maxPages:4};
}
const run=await extractMappedFeedToStaging(plan("employers"));
assert.equal(run.rowsCommitted,3);
assert.equal(run.pagesCommitted,2);
assert.deepEqual(commits,["employers:2","employers:1"]);
const small=plan("employers");small.maxBytes=1;
await assert.rejects(extractMappedFeedToStaging(small),/byte budget/);
const wrong=plan("employers");wrong.reader={...wrong.reader,snapshotConsistent:false as true};
await assert.rejects(extractMappedFeedToStaging(wrong),/Snapshot-consistent/);
const truncated=plan("employers");truncated.catalog=catalog.slice(0,2);
await assert.rejects(extractMappedFeedToStaging(truncated),/mapping|catalogue/i);
const failure=plan("employers");let wrote=0;
failure.sink={commitPage:async()=>{wrote++;throw new Error("storage unavailable")}};
await assert.rejects(extractMappedFeedToStaging(failure),/storage unavailable/);
assert.equal(wrote,1);
const ordered:string[]=[];
const result=await extractTenMappedFeeds(feed=>{const p=plan(feed);
 p.sink={commitPage:async()=>{ordered.push(feed)}};
 return p;});
assert.equal(result.summaries.length,10);
assert.deepEqual(ordered.filter((_,i)=>i%2===0),LOAD_ORDER);
await assert.rejects(extractTenMappedFeeds(feed=>plan(feed==="employers"?"employees":feed)),/dependency order/);
let built=0;
await assert.rejects(extractTenMappedFeeds(feed=>{built++;return plan(feed)},{
 maxTotalRows:50,maxTotalBytes:100000,maxTotalPages:100
}),/reservation/);
assert.equal(built,10);
const budgeted=await extractTenMappedFeeds(feed=>plan(feed),{
 maxTotalRows:100,maxTotalBytes:100000,maxTotalPages:40
});
assert.equal(budgeted.summaries.length,10);
const validStrict=plan("employers");validStrict.canonicalValidation="strict";
assert.equal((await extractMappedFeedToStaging(validStrict)).rowsCommitted,3);
const invalidStrict=plan("employees");invalidStrict.canonicalValidation="strict";
let invalidWrites=0;
invalidStrict.sink={commitPage:async()=>{invalidWrites++;}};
await assert.rejects(extractMappedFeedToStaging(invalidStrict),/Canonical mapping validation failed/);
assert.equal(invalidWrites,0);
// A mid-page invalid row must never advance the durable sink, and
// retrying from the prior checkpoint must process the same page.
const invalidPage=plan("employers");
let invalidPageCommits=0;
invalidPage.reader={snapshotId:"snap_1",snapshotConsistent:true,queryReadOnly:async()=>[
 rowFor("employers",0),{...rowFor("employers",1),source_updated_at:"invalid"}
]};
invalidPage.sink={commitPage:async()=>{invalidPageCommits++;}};
await assert.rejects(extractMappedFeedToStaging(invalidPage),/Invalid source timestamp/);
assert.equal(invalidPageCommits,0);
const retrograde=plan("employers");
let retrogradeWrites=0;
retrograde.reader={snapshotId:"snap_1",snapshotConsistent:true,queryReadOnly:async()=>[
 rowFor("employers",1),rowFor("employers",0)
]};
retrograde.sink={commitPage:async()=>{retrogradeWrites++;}};
await assert.rejects(extractMappedFeedToStaging(retrograde),/out of order/);
assert.equal(retrogradeWrites,0);
const historicalDate=plan("employees");
const historicalFormat=getFormat("employees")!;
const datedRow=Object.fromEntries(historicalFormat.fields.filter(f=>f.required).map(f=>[
 f.name,f.name==="source_updated_at"?new Date("2026-10-16T12:00:00Z"):
 f.name==="observed_at"?new Date("2026-10-15T00:00:00Z"):"k"
]));
let receivedCursor:string|number|undefined;
let servedHistorical=false;
historicalDate.reader={snapshotId:"snap_1",snapshotConsistent:true,
 queryReadOnly:async()=>servedHistorical?[]:(servedHistorical=true,[datedRow])};
historicalDate.sink={commitPage:async receipt=>{
 receivedCursor=receipt.after.keys[receipt.after.keys.length-1];
}};
assert.equal((await extractMappedFeedToStaging(historicalDate)).rowsCommitted,1);
assert.equal(receivedCursor,"2026-10-15");
console.log("Mapped SQL executor staging: ten feeds, ordering, budgets, and fail-closed writes passed");
