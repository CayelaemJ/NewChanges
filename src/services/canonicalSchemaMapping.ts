// Read-only schema mapping: arbitrary source table/column names -> canonical feeds.
// No SQL execution or implicit tenant/source identity mapping.
import {LOAD_ORDER,getFormat} from "./reportFormats.js";

export interface CanonicalFeedMapping {
 feed:string;
 sourceTable:string;
 columns:Record<string,string>;
}
export interface CanonicalSchemaMapping {
 sourceGeneration:string;
 feeds:readonly CanonicalFeedMapping[];
}
const identifier=/^[A-Za-z_][A-Za-z0-9_]*$/;
const tableName=/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/;
const validObject=(v:unknown):v is Record<string,unknown>=>typeof v==="object"&&v!==null&&!Array.isArray(v);
export function validateCanonicalSchemaMapping(mapping:CanonicalSchemaMapping){
 const issues:string[]=[];
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(mapping.sourceGeneration))issues.push("Invalid source generation");
 if(!Array.isArray(mapping.feeds)||mapping.feeds.length!==LOAD_ORDER.length)
  issues.push("Exactly ten canonical feed mappings required");
 const seen=new Set<string>();
 for(const item of mapping.feeds??[]){
  if(!validObject(item)||typeof item.feed!=="string") {issues.push("Invalid feed mapping");continue;}
  const format=getFormat(item.feed);
  if(!format||!LOAD_ORDER.includes(item.feed)){issues.push("Unrecognized canonical feed");continue;}
  if(seen.has(item.feed))issues.push("Duplicate canonical feed: "+item.feed);
  seen.add(item.feed);
  if(typeof item.sourceTable!=="string"||!tableName.test(item.sourceTable))
   issues.push(item.feed+": invalid source table/view");
  if(!validObject(item.columns)){issues.push(item.feed+": invalid column mapping");continue;}
  const allowed=new Set(format.fields.map(f=>f.name));
  for(const required of format.fields.filter(f=>f.required)){
   if(typeof item.columns[required.name]!=="string"||!identifier.test(item.columns[required.name]))
    issues.push(item.feed+": missing required mapped field "+required.name);
  }
  for(const key of Object.keys(item.columns)){
   if(!allowed.has(key)||typeof item.columns[key]!=="string"||!identifier.test(item.columns[key]))
    issues.push(item.feed+": invalid mapped column "+key);
  }
 }
 for(const feed of LOAD_ORDER)if(!seen.has(feed))issues.push("Missing canonical mapping: "+feed);
 return {valid:issues.length===0,issues,executionEnabled:false as const};
}
/** Coerce nothing: canonical field validation remains responsible for types/dates. */
export function mapSourceRow(mapping:CanonicalFeedMapping,sourceRow:Record<string,unknown>){
 const format=getFormat(mapping.feed);
 if(!format)throw new Error("Unknown canonical feed");
 const result:Record<string,unknown>={};
 for(const f of format.fields){
  const column=mapping.columns[f.name];
  if(column!==undefined){
   if(!Object.prototype.hasOwnProperty.call(sourceRow,column))
    throw new Error("Mapped source column missing: "+column);
   result[f.name]=sourceRow[column];
  }
 }
 return result;
}
/** Source-specific mapping previews must be reviewed before any SQL is run. */
export function previewCanonicalMapping(mapping:CanonicalSchemaMapping){
 const review=validateCanonicalSchemaMapping(mapping);
 return { ...review,loadOrder:[...LOAD_ORDER],
  mappedFields:mapping.feeds?.map(f=>({feed:f.feed,sourceTable:f.sourceTable,fieldCount:Object.keys(f.columns??{}).length}))??[] };
}
