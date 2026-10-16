import assert from "node:assert/strict";
import {LOAD_ORDER,getFormat} from "../src/services/reportFormats.js";
import {buildSourceMetadataQuery,reviewMappingAgainstCatalog,suggestExactNameMatches,validateDiscoveredCatalog} from "../src/services/canonicalSchemaDiscovery.js";
const catalog=LOAD_ORDER.flatMap(feed=>getFormat(feed)!.fields.filter(f=>f.required).map(f=>({
 schema:"legacy",table:feed+"_data",column:f.name==="source_updated_at"?"last_modified":"src_"+f.name,
 dataType:f.type==="datetime"?"timestamp":"text",nullable:false
})));
const mapping={sourceGeneration:"legacy-001",feeds:LOAD_ORDER.map(feed=>({
 feed,sourceTable:"legacy."+feed+"_data",
 columns:Object.fromEntries(getFormat(feed)!.fields.filter(f=>f.required).map(f=>[
 f.name,f.name==="source_updated_at"?"last_modified":"src_"+f.name
 ]))
}))};
for(const dialect of ["MYSQL","POSTGRESQL","MSSQL"] as const){
 const q=buildSourceMetadataQuery(dialect,"legacy");
 assert.equal(q.readOnly,true);
 assert(q.sql.includes("information_schema.columns"));
 assert.deepEqual(q.params,["legacy",5000]);
 assert(!q.sql.includes("legacy"));
}
assert.throws(()=>buildSourceMetadataQuery("MYSQL","legacy;drop"),/schema/);
assert.throws(()=>buildSourceMetadataQuery("MYSQL","legacy",5001),/budget/);
const good=reviewMappingAgainstCatalog(mapping,catalog);
assert.equal(good.validForSampleReview,true,JSON.stringify(good.issues));
assert.equal(good.previews.length,10);
assert.equal(good.executionEnabled,false);
assert.equal(good.mappingApprovalRequired,true);
assert.equal(good.sourceDataSampled,false);
assert.equal(reviewMappingAgainstCatalog(mapping,catalog.slice(1)).validForSampleReview,false);
assert.equal(reviewMappingAgainstCatalog(mapping,[...catalog,catalog[0]]).validForSampleReview,false);
assert.equal(reviewMappingAgainstCatalog({...mapping,feeds:mapping.feeds.map((f,i)=>i===0?{...f,sourceTable:"missing.table"}:f)},catalog).validForSampleReview,false);
assert.deepEqual(suggestExactNameMatches("employers",catalog),[]);
assert.deepEqual(suggestExactNameMatches("employers",[{schema:"legacy",table:"clients",column:"employer_ref",dataType:"text",nullable:false}]).map(x=>x.canonical),["employer_ref"]);
const catalogStatus=validateDiscoveredCatalog(catalog,"legacy");
assert.equal(catalogStatus.complete,true);
assert.equal(catalogStatus.executionEnabled,false);
assert.equal(validateDiscoveredCatalog(catalog.slice(0,2),"legacy",2).complete,false);
assert.equal(validateDiscoveredCatalog(catalog.slice(0,1),"wrong").complete,false);
assert.equal(validateDiscoveredCatalog([...catalog,catalog[0]],"legacy").complete,false);
assert.equal(validateDiscoveredCatalog([{...catalog[0],nullable:"NO" as unknown as boolean}],"legacy").complete,false);
console.log("Bounded information_schema discovery plans and ten-feed catalogue review passed");
