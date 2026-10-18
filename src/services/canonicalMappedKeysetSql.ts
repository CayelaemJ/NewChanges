// Pure, read-only SQL compiler for approved candidate schema mappings.
// No database connections, source queries, imports, writes or publication.
import {getFormat} from "./reportFormats.js";
import {validateCanonicalSchemaMapping,type CanonicalSchemaMapping} from "./canonicalSchemaMapping.js";
import {reviewMappingAgainstCatalog,type DiscoveryColumn,type DiscoveryDialect} from "./canonicalSchemaDiscovery.js";
import type {KeysetCursor} from "./datasetReplacementKeysetSql.js";

const identifier=/^[A-Za-z_][A-Za-z0-9_]*$/;
const timestamp=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const safeDate=(value:string)=>timestamp.test(value)&&Number.isFinite(Date.parse(value));
export interface MappedKeysetOptions {
 dialect:DiscoveryDialect;
 feed:string;
 upperWatermark:string;
 after?:KeysetCursor|null;
 limit:number;
}
/** Caller must use a snapshot-consistent read and transactionally idempotent commits. */
export function compileMappedCanonicalKeysetQuery(
 mapping:CanonicalSchemaMapping,
 catalog:readonly DiscoveryColumn[],
 options:MappedKeysetOptions,
):{sql:string;params:(string|number)[];keyColumns:string[]} {
 const review=validateCanonicalSchemaMapping(mapping);
 if(!review.valid)throw new Error("Invalid canonical source mapping: "+review.issues.join("; "));
 const catalogReview=reviewMappingAgainstCatalog(mapping,catalog);
 if(!catalogReview.validForSampleReview)
  throw new Error("Mapping references missing or ambiguous source metadata: "+catalogReview.issues.join("; "));
 const format=getFormat(options.feed);
 const feed=mapping.feeds.find(f=>f.feed===options.feed);
 if(!format||!feed)throw new Error("Unknown mapped canonical feed");
 if(!["MYSQL","POSTGRESQL","MSSQL"].includes(options.dialect))
  throw new Error("Unsupported mapped SQL dialect");
 if(!Number.isSafeInteger(options.limit)||options.limit<1||options.limit>1000)
  throw new Error("Invalid mapped extraction page size");
 if(!safeDate(options.upperWatermark))throw new Error("Invalid upper source watermark");
 if(options.after){
  if(!safeDate(options.after.updatedAt)||options.after.keys.length!==format.naturalKey.length||
   options.after.keys.some(k=>typeof k==="string"?(k.length===0||k.length>2048):
    typeof k!=="number"||!Number.isSafeInteger(k)))
   throw new Error("Invalid mapped keyset cursor");
  if(Date.parse(options.after.updatedAt)>Date.parse(options.upperWatermark))
   throw new Error("Mapped cursor exceeds source watermark");
 }
 const parts=feed.sourceTable.split(".");
 if(parts.length!==2||!parts.every(p=>identifier.test(p)))
  throw new Error("Source table must be schema-qualified");
 const quote=(n:string)=>options.dialect==="MYSQL"?"`"+n+"`":
  options.dialect==="MSSQL"?"["+n+"]":'"'+n+'"';
 const physical=(canonical:string)=>{
  const column=feed.columns[canonical];
  if(!column||!identifier.test(column))throw new Error("Missing mapped canonical column "+canonical);
  return quote(column);
 };
 // Only mapped canonical columns are extracted: never SELECT * from wide raw sources.
 const projection=format.fields.filter(f=>feed.columns[f.name]).map(f=>
  physical(f.name)+" AS "+quote(f.name)).join(", ");
 const table=parts.map(quote).join(".");
 const params:(string|number)[]=[];
 const bind=(v:string|number)=>{
  params.push(v);
  return options.dialect==="POSTGRESQL"?"$"+params.length:
   options.dialect==="MSSQL"?"@p"+params.length:"?";
 };
 const ts=physical("source_updated_at");
 const upper=bind(options.upperWatermark);
 const conditions=[ts+" <= "+upper];
 if(options.after){
  const later=ts+" > "+bind(options.after.updatedAt);
  const equalTime=ts+" = "+bind(options.after.updatedAt);
  const branches:string[]=[];
  for(let i=0;i<format.naturalKey.length;i++){
   const and:string[]=[];
   for(let j=0;j<i;j++)and.push(physical(format.naturalKey[j])+" = "+bind(options.after.keys[j]));
   and.push(physical(format.naturalKey[i])+" > "+bind(options.after.keys[i]));
   branches.push("("+and.join(" AND ")+")");
  }
  conditions.push("("+later+" OR ("+equalTime+" AND ("+branches.join(" OR ")+")))");
 }
 const ordering=[ts,...format.naturalKey.map(physical)].map(x=>x+" ASC").join(", ");
 const limit=bind(options.limit);
 const suffix=options.dialect==="MSSQL"?" OFFSET 0 ROWS FETCH NEXT "+limit+" ROWS ONLY":
  " LIMIT "+limit;
 return {sql:"SELECT "+projection+" FROM "+table+" WHERE "+conditions.join(" AND ")+
  " ORDER BY "+ordering+suffix,params,keyColumns:[...format.naturalKey]};
}
