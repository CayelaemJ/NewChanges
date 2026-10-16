// Explicit opt-in isolated MySQL mapped staging rehearsal.
// Nothing calls this from the live API, scheduler or production import path.
import {LOAD_ORDER} from "./reportFormats.js";
import {validateCanonicalSchemaMapping,type CanonicalSchemaMapping} from "./canonicalSchemaMapping.js";
import {openPlaygroundMysqlSnapshot,type PlaygroundMysqlSource} from "./playgroundMysqlSnapshot.js";
import {createPlaygroundMappedStagingStore} from "./playgroundMappedStagingStore.js";
import {extractTenMappedFeeds} from "./canonicalMappedStagingRunner.js";
import type {DiscoveryColumn} from "./canonicalSchemaDiscovery.js";

export interface PlaygroundMappedMysqlRehearsal {
 approvedForPlayground:true;
 source:PlaygroundMysqlSource;
 mapping:CanonicalSchemaMapping;
 stagingRoot:string;
 upperWatermark:string;
 pageSize:number;
 maxRowsPerFeed:number;
 maxBytesPerFeed:number;
 maxPagesPerFeed:number;
 maxTotalRows:number;
 maxTotalBytes:number;
 maxTotalPages:number;
}
/** Results contain counts/receipts only; never source credentials or employee rows. */
export async function rehearseMappedMysqlImport(input:PlaygroundMappedMysqlRehearsal){
 if(input.approvedForPlayground!==true)throw new Error("Playground-only approval required");
 const review=validateCanonicalSchemaMapping(input.mapping);
 if(!review.valid)throw new Error("Invalid mapping: "+review.issues.join("; "));
 if(typeof input.stagingRoot!=="string"||!input.stagingRoot.startsWith("/")||
   input.stagingRoot.includes(".."))
  throw new Error("Absolute isolated staging root required");
 if(!Number.isSafeInteger(input.pageSize)||input.pageSize<1||input.pageSize>250||
   !Number.isSafeInteger(input.maxRowsPerFeed)||input.maxRowsPerFeed<1||
   !Number.isSafeInteger(input.maxBytesPerFeed)||input.maxBytesPerFeed<1||
   !Number.isSafeInteger(input.maxPagesPerFeed)||input.maxPagesPerFeed<1||
   !Number.isSafeInteger(input.maxTotalRows)||input.maxTotalRows<1||
   !Number.isSafeInteger(input.maxTotalBytes)||input.maxTotalBytes<1||
   !Number.isSafeInteger(input.maxTotalPages)||input.maxTotalPages<1)
  throw new Error("Invalid Playground feed budgets");
 // Reserve an upper bound before making a network connection.
 const allocations={
  rows:LOAD_ORDER.length*input.maxRowsPerFeed,
  bytes:LOAD_ORDER.length*input.maxBytesPerFeed,
  pages:LOAD_ORDER.length*input.maxPagesPerFeed,
 };
 if(![allocations.rows,allocations.bytes,allocations.pages].every(Number.isSafeInteger)||
   allocations.rows>input.maxTotalRows||
   allocations.bytes>input.maxTotalBytes||
   allocations.pages>input.maxTotalPages)
  throw new Error("Ten-feed Playground cost reservation exceeds approved aggregate budget");
 const source=await openPlaygroundMysqlSnapshot(input.source);
 try{
  const schemas=[...new Set(input.mapping.feeds.map(f=>f.sourceTable.split(".")[0]))];
  const catalog:DiscoveryColumn[]=[];
  for(const schema of schemas)catalog.push(...await source.discoverColumns(schema));
  const store=createPlaygroundMappedStagingStore(input.stagingRoot);
  const stage=await extractTenMappedFeeds(feed=>({
   mapping:input.mapping,catalog,dialect:"MYSQL",feed,upperWatermark:input.upperWatermark,
   reader:source,sink:store.sink,canonicalValidation:"strict",
   pageSize:input.pageSize,maxRows:input.maxRowsPerFeed,maxBytes:input.maxBytesPerFeed,
   maxPages:input.maxPagesPerFeed,
  }),{
   maxTotalRows:input.maxTotalRows,maxTotalBytes:input.maxTotalBytes,maxTotalPages:input.maxTotalPages
  });
  return {snapshotId:source.snapshotId,sourceGeneration:input.mapping.sourceGeneration,
   feeds:stage.summaries.map(s=>({feed:s.feed,rowsCommitted:s.rowsCommitted,
     bytesRead:s.bytesRead,pagesCommitted:s.pagesCommitted})),
   publicationEnabled:false as const,productionEnabled:false as const};
 }finally{await source.close();}
}
