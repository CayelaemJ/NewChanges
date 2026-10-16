// Isolated mapped SQL extraction runner. No real DB credentials, Neon writes,
// source switching, or publication: callers inject a snapshot-consistent reader.
import {createHash} from "node:crypto";
import {LOAD_ORDER,getFormat} from "./reportFormats.js";
import {compileMappedCanonicalKeysetQuery} from "./canonicalMappedKeysetSql.js";
import type {CanonicalSchemaMapping} from "./canonicalSchemaMapping.js";
import type {DiscoveryColumn,DiscoveryDialect} from "./canonicalSchemaDiscovery.js";
import {validateDiscoveredCatalog,reviewMappingAgainstCatalog} from "./canonicalSchemaDiscovery.js";
import type {KeysetCursor} from "./datasetReplacementKeysetSql.js";
import {validateMappedCanonicalPage} from "./canonicalMappedRowValidation.js";

export interface MappedSqlReader {
 readonly snapshotId:string;
 readonly snapshotConsistent:true;
 queryReadOnly(sql:string,params:readonly (string|number)[]):Promise<readonly Record<string,unknown>[]>;
}
export interface MappedStagingSink {
 // Must atomically persist idempotent staged rows + the checkpoint in the
 // same durable transaction. Reject foreign generation/snapshot identities.
 commitPage(input:{
  generation:string; snapshotId:string; feed:string;
  rows:readonly Record<string,unknown>[]; after:KeysetCursor;
  pageDigest:string;
 }):Promise<void>;
}
export interface MappedFeedRun {
 mapping:CanonicalSchemaMapping; catalog:readonly DiscoveryColumn[];
 dialect:DiscoveryDialect; feed:string; upperWatermark:string;
 reader:MappedSqlReader; sink:MappedStagingSink;
 after?:KeysetCursor|null;
 canonicalValidation?:"strict";
 maxRows:number;maxBytes:number;pageSize:number;maxPages:number;
}
const normalizedStamp=(v:unknown):string=>{
 if(v instanceof Date)return v.toISOString();
 if(typeof v!=="string"||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(v)
  ||!Number.isFinite(Date.parse(v)))throw new Error("Invalid source timestamp; explicit UTC required");
 return v;
};
const validIdentity=(s:string)=>/^[A-Za-z0-9_-]{1,128}$/.test(s);
function normalizeNaturalKey(value:unknown,fieldType:string):string|number{
 if(value instanceof Date){
  if(!Number.isFinite(value.getTime())||!(fieldType==="date"||fieldType==="datetime"))
   throw new Error("Invalid source natural-key date");
  return fieldType==="date"?value.toISOString().slice(0,10):value.toISOString();
 }
 if(typeof value==="string"&&value.length>0&&value.length<=2048)return value;
 if(typeof value==="number"&&Number.isSafeInteger(value))return value;
 throw new Error("Missing or invalid source natural key");
}
/** A caller cannot confuse a keyset cursor from one feed with another. */
export async function extractMappedFeedToStaging(input:MappedFeedRun){
 const {mapping,catalog,dialect,feed,reader,sink}=input;
 if(!LOAD_ORDER.includes(feed)||!getFormat(feed))throw new Error("Unknown feed");
 const format=getFormat(feed)!;
 const schema=mapping.feeds.find(f=>f.feed===feed)?.sourceTable.split(".")[0]??"";
 const discovered=validateDiscoveredCatalog(catalog.filter(c=>c.schema===schema),schema);
 if(!discovered.complete)throw new Error("Incomplete source catalogue: "+discovered.issues.join("; "));
 if(!reviewMappingAgainstCatalog(mapping,catalog).validForSampleReview)
  throw new Error("Invalid source mapping for catalogue");
 if(reader.snapshotConsistent!==true||!validIdentity(reader.snapshotId))
  throw new Error("Snapshot-consistent source reader required");
 if(!validIdentity(mapping.sourceGeneration))throw new Error("Invalid source generation");
 if(!Number.isSafeInteger(input.pageSize)||input.pageSize<1||input.pageSize>1000||
  !Number.isSafeInteger(input.maxRows)||input.maxRows<1||
  !Number.isSafeInteger(input.maxBytes)||input.maxBytes<1||
  !Number.isSafeInteger(input.maxPages)||input.maxPages<1)
   throw new Error("Invalid extraction budget");
 let after=input.after??null,rowsCommitted=0,bytesRead=0,pagesCommitted=0;
 while(true){
  const exhausted=rowsCommitted>=input.maxRows||pagesCommitted>=input.maxPages;
  const count=exhausted?1:Math.min(input.pageSize,input.maxRows-rowsCommitted);
  const query=compileMappedCanonicalKeysetQuery(mapping,catalog,{
   dialect,feed,upperWatermark:input.upperWatermark,after,limit:count
  });
  const records=await reader.queryReadOnly(query.sql,query.params);
  if(!Array.isArray(records)||records.length>count)
   throw new Error("Read-only source returned an invalid or oversized page");
  if(records.length===0)break;
  if(exhausted)throw new Error("Extraction row/page budget reached before EOF");
  let pageBytes=0,last:KeysetCursor|null=null;
  let previous:KeysetCursor|null=after;
  for(const record of records){
   if(!record||typeof record!=="object"||Array.isArray(record))throw new Error("Invalid source record");
   // SQL projection must contain only the approved fields and all required keys.
   const columns=new Set(format.fields.filter(f=>mapping.feeds.find(m=>m.feed===feed)?.columns[f.name]).map(f=>f.name));
   for(const key of Object.keys(record))if(!columns.has(key))throw new Error("Unexpected source projection column");
   for(const f of format.fields.filter(f=>f.required))
    if(!Object.prototype.hasOwnProperty.call(record,f.name)||record[f.name]==null)
      throw new Error("Missing required canonical source field: "+f.name);
   const updatedAt=normalizedStamp(record.source_updated_at);
   const keys=format.naturalKey.map(k=>normalizeNaturalKey(
    record[k],format.fields.find(f=>f.name===k)?.type??"string"));
   // SQL driver keyset order is authoritative; require forward timestamp
   // progress, and reject identical cursor tuples to avoid stuck replays.
   if(previous&&Date.parse(updatedAt)<Date.parse(previous.updatedAt))
     throw new Error("Source timestamp regressed");
   if(previous&&Date.parse(updatedAt)===Date.parse(previous.updatedAt)){
    let order=0;
    for(let i=0;i<keys.length;i++){
     const currentKey=keys[i],priorKey=previous.keys[i];
     if(currentKey===priorKey)continue;
     if(typeof currentKey==="string"&&typeof priorKey==="string")
      order=currentKey<priorKey?-1:1;
     else if(typeof currentKey==="number"&&typeof priorKey==="number")
      order=currentKey<priorKey?-1:1;
     else throw new Error("Source keyset cursor changed type");
     break;
    }
    if(order<=0)throw new Error("Source keyset cursor duplicated or out of order");
   }
   last={updatedAt,keys:keys as (string|number)[]};
   previous=last;
   const encoded=JSON.stringify(record);
   if(!encoded)throw new Error("Invalid projected record");
   pageBytes+=Buffer.byteLength(encoded,"utf8");
   if(!Number.isSafeInteger(pageBytes)||pageBytes>input.maxBytes-bytesRead)
     throw new Error("Mapped source byte budget exceeded before staged write");
  }
  if(!last)throw new Error("Missing page checkpoint");
  const stagedRows=input.canonicalValidation==="strict"
   ?validateMappedCanonicalPage(feed,records):records;
  const pageDigest=createHash("sha256").update(JSON.stringify(stagedRows)).digest("hex");
  await sink.commitPage({generation:mapping.sourceGeneration,snapshotId:reader.snapshotId,
   feed,rows:stagedRows,after:last,pageDigest});
  // Cursor advances only after the single atomic sink commit.
  after=last;
  rowsCommitted+=records.length;bytesRead+=pageBytes;pagesCommitted++;
  if(records.length<count)break;
 }
 return {feed,rowsCommitted,bytesRead,pagesCommitted,after,
  publicationEnabled:false as const};
}

/** Fail-closed dependency order; a failed feed blocks all downstream feeds. */
export interface TenFeedBudget{maxTotalRows:number;maxTotalBytes:number;maxTotalPages:number}
/** Optional aggregated budget is checked BEFORE extraction, not after expenses occur. */
export async function extractTenMappedFeeds(
 makeRun:(feed:string)=>MappedFeedRun,
 aggregate?:TenFeedBudget,
){
 const plans=LOAD_ORDER.map(feed=>makeRun(feed));
 if(plans.some((p,i)=>p.feed!==LOAD_ORDER[i]))
  throw new Error("Mapped feed dependency order changed");
 if(aggregate){
  if(!Number.isSafeInteger(aggregate.maxTotalRows)||aggregate.maxTotalRows<1||
   !Number.isSafeInteger(aggregate.maxTotalBytes)||aggregate.maxTotalBytes<1||
   !Number.isSafeInteger(aggregate.maxTotalPages)||aggregate.maxTotalPages<1)
    throw new Error("Invalid aggregate mapped transfer budget");
  // Reject a configuration whose worst-case total exceeds the approved cap
  // before reading any source rows or creating any staging objects.
  const sum=(field:"maxRows"|"maxBytes"|"maxPages")=>plans.reduce((n,p)=>n+p[field],0);
  if(![sum("maxRows"),sum("maxBytes"),sum("maxPages")].every(Number.isSafeInteger)||
    sum("maxRows")>aggregate.maxTotalRows||
    sum("maxBytes")>aggregate.maxTotalBytes||
    sum("maxPages")>aggregate.maxTotalPages)
   throw new Error("Ten-feed transfer reservation exceeds approved budget");
 }
 const summaries=[];
 for(const run of plans)summaries.push(await extractMappedFeedToStaging(run));
 return {summaries,publicationEnabled:false as const};
}
