import assert from "node:assert/strict";
import {LOAD_ORDER,getFormat} from "../src/services/reportFormats.js";
import {buildCanonicalKeysetQuery} from "../src/services/datasetReplacementKeysetSql.js";
for(const dialect of ["POSTGRESQL","MYSQL","MSSQL"] as const){
 for(const feed of LOAD_ORDER){
  const format=getFormat(feed)!;
  const query=buildCanonicalKeysetQuery({dialect,feed,upperWatermark:"2026-10-16T12:00:00Z",
   after:{updatedAt:"2026-10-15T10:00:00Z",keys:format.naturalKey.map((_,i)=>"KEY"+i)},limit:200});
  assert(query.sql.includes("ORDER BY"));
  assert(query.sql.includes("source_updated_at"));
  assert(query.sql.includes("200")===false || query.params.includes(200));
  assert(query.params.includes(200));
  for(const key of format.naturalKey)assert(query.sql.includes(key));
  assert(!/\bOFFSET [1-9]/.test(query.sql));
 }
}
const opts={dialect:"POSTGRESQL" as const,feed:"employees",upperWatermark:"2026-10-16T12:00:00Z",limit:10};
const first=buildCanonicalKeysetQuery(opts);
assert.equal(first.params.length,2);
assert.throws(()=>buildCanonicalKeysetQuery({...opts,limit:1001}),/page size/);
assert.throws(()=>buildCanonicalKeysetQuery({...opts,schema:"tenant; DROP TABLE users"}),/schema/);
assert.throws(()=>buildCanonicalKeysetQuery({...opts,feed:"made_up"}),/feed/);
assert.throws(()=>buildCanonicalKeysetQuery({...opts,after:{updatedAt:"2026-10-17T12:00:00Z",keys:["a","b","c"]}}),/watermark/);
assert.throws(()=>buildCanonicalKeysetQuery({...opts,after:{updatedAt:"2026-10-15T12:00:00Z",keys:["a"]}}),/cursor/);
console.log("Parameterized keyset SQL plans pass all ten canonical feeds and three SQL dialects");
