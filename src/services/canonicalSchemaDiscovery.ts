// Read-only, bounded discovery planning and catalogue-backed mapping review.
// Does not connect to the source, inspect user records, or execute SQL.
import {getFormat,LOAD_ORDER} from "./reportFormats.js";
import {validateCanonicalSchemaMapping,type CanonicalSchemaMapping} from "./canonicalSchemaMapping.js";
export type DiscoveryDialect="POSTGRESQL"|"MYSQL"|"MSSQL";
export type DiscoveryColumn={schema:string;table:string;column:string;dataType:string;nullable:boolean};
const ident=/^[A-Za-z_][A-Za-z0-9_]*$/;
export function buildSourceMetadataQuery(dialect:DiscoveryDialect,schema:string,maxColumns=5000){
 if(!["POSTGRESQL","MYSQL","MSSQL"].includes(dialect))throw new Error("Unsupported discovery dialect");
 if(!ident.test(schema))throw new Error("Invalid discovery schema");
 if(!Number.isSafeInteger(maxColumns)||maxColumns<1||maxColumns>5000)
  throw new Error("Invalid metadata column budget");
 const marker=dialect==="POSTGRESQL"?"$1":dialect==="MSSQL"?"@p1":"?";
 const limit=dialect==="POSTGRESQL"?" LIMIT $2":
   dialect==="MYSQL"?" LIMIT ?":" OFFSET 0 ROWS FETCH NEXT @p2 ROWS ONLY";
 const sql="SELECT table_schema, table_name, column_name, data_type, is_nullable "+
  "FROM information_schema.columns WHERE table_schema = "+marker+
  " ORDER BY table_name ASC, ordinal_position ASC"+limit;
 return {sql,params:[schema,maxColumns] as readonly (string|number)[],readOnly:true as const};
}
/**
 * A catalogue exactly at its row cap might have been truncated. Fail closed:
 * an incomplete column catalogue must never approve a schema mapping.
 */
export function validateDiscoveredCatalog(
 rows:readonly DiscoveryColumn[], expectedSchema:string, maxColumns=5000,
) {
 const issues:string[]=[];
 if(!ident.test(expectedSchema)||!Number.isSafeInteger(maxColumns)||maxColumns<1||maxColumns>5000)
  issues.push("Invalid discovery bounds");
 if(!Array.isArray(rows)||rows.length>=maxColumns)
  issues.push("Metadata discovery reached its column budget; catalogue may be truncated");
 const seen=new Set<string>();
 for(const row of rows??[]){
  if(!row||![row.schema,row.table,row.column].every(v=>typeof v==="string"&&ident.test(v))||
    row.schema!==expectedSchema||
    typeof row.dataType!=="string"||row.dataType.length<1||row.dataType.length>128||
    typeof row.nullable!=="boolean"){
    issues.push("Invalid source metadata row");continue;
  }
  const key=[row.schema,row.table,row.column].join(".").toLowerCase();
  if(seen.has(key))issues.push("Duplicate discovered source column");
  seen.add(key);
 }
 return {complete:issues.length===0,issues,readOnly:true as const,executionEnabled:false as const};
}
function normalized(input:string){return input.toLowerCase().replace(/[^a-z0-9]/g,"");}
export function reviewMappingAgainstCatalog(mapping:CanonicalSchemaMapping,columns:readonly DiscoveryColumn[]){
 const base=validateCanonicalSchemaMapping(mapping);
 const issues=[...base.issues];
 const validCatalog=new Map<string,Map<string,DiscoveryColumn>>();
 for(const col of columns){
  if(![col.schema,col.table,col.column].every(v=>typeof v==="string"&&ident.test(v))){
   issues.push("Invalid catalog identifier");continue;
  }
  const table=col.schema+"."+col.table;
  let names=validCatalog.get(table);
  if(!names){names=new Map();validCatalog.set(table,names);}
  if(names.has(col.column.toLowerCase()))issues.push("Ambiguous catalog column: "+table+"."+col.column);
  else names.set(col.column.toLowerCase(),col);
 }
 const previews=[];
 for(const feed of mapping.feeds??[]){
  if(!feed||!getFormat(feed.feed))continue;
  const format=getFormat(feed.feed)!;
  const table=feed.sourceTable.includes(".")?feed.sourceTable:null;
  if(!table){issues.push(feed.feed+": schema-qualified source table required");continue;}
  const known=validCatalog.get(table);
  if(!known){issues.push(feed.feed+": source table absent from discovered catalog");continue;}
  const mapped=[];
  for(const field of format.fields){
   const column=feed.columns?.[field.name];
   if(!column)continue;
   const entry=known.get(column.toLowerCase());
   if(!entry){issues.push(feed.feed+": mapped column not found: "+field.name);continue;}
   mapped.push({canonical:field.name,source:entry.column,sourceType:entry.dataType});
  }
  // Never approve semantics or identity from metadata alone.
  previews.push({feed:feed.feed,sourceTable:table,mapped});
 }
 return {validForSampleReview:issues.length===0,issues,previews,executionEnabled:false as const,
  mappingApprovalRequired:true as const,sourceDataSampled:false as const};
}
export function suggestExactNameMatches(feed:string,columns:readonly DiscoveryColumn[]){
 const format=getFormat(feed);
 if(!format||!LOAD_ORDER.includes(feed))throw new Error("Unknown canonical feed");
 const suggestions=[];
 for(const field of format.fields){
  const matches=columns.filter(c=>normalized(c.column)===normalized(field.name));
  if(matches.length===1)suggestions.push({canonical:field.name,source:matches[0].column,
   sourceTable:matches[0].schema+"."+matches[0].table,confidence:"name-only" as const});
 }
 return suggestions;
}
