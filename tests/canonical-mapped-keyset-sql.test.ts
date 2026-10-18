import assert from "node:assert/strict";
import {LOAD_ORDER,getFormat} from "../src/services/reportFormats.js";
import {compileMappedCanonicalKeysetQuery} from "../src/services/canonicalMappedKeysetSql.js";
const catalog=LOAD_ORDER.flatMap(feed=>getFormat(feed)!.fields.filter(f=>f.required).map(f=>({
 schema:"legacy",table:feed+"_archive",column:f.name==="source_updated_at"?"last_changed":"raw_"+f.name,
 dataType:f.type==="datetime"?"timestamp":"text",nullable:false
})));
const mapping={sourceGeneration:"legacy_v2",feeds:LOAD_ORDER.map(feed=>({
 feed,sourceTable:"legacy."+feed+"_archive",
 columns:Object.fromEntries(getFormat(feed)!.fields.filter(f=>f.required).map(f=>
  [f.name,f.name==="source_updated_at"?"last_changed":"raw_"+f.name]))
}))};
const upperWatermark="2026-10-16T12:00:00Z";
for(const dialect of ["MYSQL","POSTGRESQL","MSSQL"] as const){
 for(const feed of LOAD_ORDER){
  const keys=getFormat(feed)!.naturalKey;
  const q=compileMappedCanonicalKeysetQuery(mapping,catalog,{dialect,feed,upperWatermark,
   after:{updatedAt:"2026-10-15T08:00:00Z",keys:keys.map((_,i)=>"key"+i)},limit:100});
  assert(q.sql.startsWith("SELECT "));
  assert(q.sql.includes("last_changed"));
  assert(q.sql.includes("raw_"));
  assert(!q.sql.includes("SELECT *"));
  assert(q.sql.includes("ORDER BY"));
  assert(q.params.includes(100));
  assert.deepEqual(q.keyColumns,keys);
  assert(q.params.includes(upperWatermark));
  assert(!q.sql.includes("2026-10-16T12:00:00Z"));
 }
}
const opts={dialect:"MYSQL" as const,feed:"employees",upperWatermark,limit:100};
assert.equal(compileMappedCanonicalKeysetQuery(mapping,catalog,opts).params.length,2);
assert.throws(()=>compileMappedCanonicalKeysetQuery(mapping,catalog.slice(1),opts),/source metadata/);
assert.throws(()=>compileMappedCanonicalKeysetQuery(mapping,catalog,{...opts,limit:1001}),/page size/);
assert.throws(()=>compileMappedCanonicalKeysetQuery(mapping,catalog,{...opts,after:{updatedAt:upperWatermark,keys:["only-one"]}}),/cursor/);
assert.throws(()=>compileMappedCanonicalKeysetQuery(mapping,catalog,{...opts,feed:"unknown"}),/feed/);
assert.throws(()=>compileMappedCanonicalKeysetQuery({...mapping,feeds:mapping.feeds.map((f,i)=>i===0?{...f,sourceTable:"legacy.employers_archive;DROP"}:f)},catalog,opts),/mapping/);
console.log("Mapped ten-feed SQL projections and keyset cursors compiled safely in three dialects");
