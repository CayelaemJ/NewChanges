import assert from "node:assert/strict";
import {LOAD_ORDER,getFormat} from "../src/services/reportFormats.js";
import {validateCanonicalSchemaMapping,mapSourceRow,previewCanonicalMapping} from "../src/services/canonicalSchemaMapping.js";
const feeds=LOAD_ORDER.map(feed=>({feed,sourceTable:"legacy."+feed+"_data",
 columns:Object.fromEntries(getFormat(feed)!.fields.filter(f=>f.required).map(f=>[f.name,f.name==="source_updated_at"?"last_modified":"src_"+f.name]))}));
const mapping={sourceGeneration:"legacy-001",feeds};
assert.equal(validateCanonicalSchemaMapping(mapping).valid,true);
assert.deepEqual(previewCanonicalMapping(mapping).loadOrder,LOAD_ORDER);
const employee=feeds.find(f=>f.feed==="employees")!;
const row=Object.fromEntries(Object.entries(employee.columns).map(([to,from])=>[from,to==="source_updated_at"?"2026-10-16T12:00:00Z":"example"]));
assert.equal(mapSourceRow(employee,row).source_updated_at,"2026-10-16T12:00:00Z");
assert.equal(mapSourceRow(employee,row).employer_ref,"example");
assert.throws(()=>mapSourceRow(employee,{}),/missing/);
assert.equal(validateCanonicalSchemaMapping({...mapping,feeds:feeds.slice(1)}).valid,false);
assert.equal(validateCanonicalSchemaMapping({...mapping,feeds:[...feeds.slice(1),feeds[1]]}).valid,false);
assert.equal(validateCanonicalSchemaMapping({...mapping,feeds:feeds.map((f,i)=>i===0?{...f,sourceTable:"data;DROP TABLE app"}:f)}).valid,false);
assert.equal(validateCanonicalSchemaMapping({...mapping,feeds:feeds.map((f,i)=>i===0?{...f,columns:{}}:f)}).valid,false);
assert.equal(validateCanonicalSchemaMapping({...mapping,feeds:feeds.map((f,i)=>i===0?{...f,columns:{...f.columns,name:"other;DROP"}}:f)}).valid,false);
console.log("Canonical source schema mapping and tenant/date field safeguards passed");
