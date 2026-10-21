// Explicit Testing-only MySQL -> signed cloud staging rehearsal.
// It is not imported by the API, scheduler, or production publisher.
import pg from "pg";
import {LOAD_ORDER} from "./reportFormats.js";
import {validateCanonicalSchemaMapping} from "./canonicalSchemaMapping.js";
import {reviewMappingAgainstCatalog,type DiscoveryColumn} from "./canonicalSchemaDiscovery.js";
import {openPlaygroundMysqlSnapshot} from "./playgroundMysqlSnapshot.js";
import {extractTenMappedFeeds} from "./canonicalMappedStagingRunner.js";
import {createIsolatedCloudPageSink} from "./isolatedCloudPageSink.js";
import {createBoundedCloudStageHttp} from "./boundedCloudStageHttp.js";
import {createFencedCloudReceiptRecorder} from "./fencedCloudReceiptRecorder.js";
import {createMappedStagingEvidenceSink} from "./mappedStagingEvidence.js";
import type {CloudPageReceipt} from "./isolatedCloudPageSink.js";
import type {PlaygroundMappedMysqlRehearsal} from "./playgroundMappedImportRehearsal.js";
import type {StagingSqlExecutor} from "./fencedStagingLedger.js";

const TEN_MIB=10*1024*1024;
export function validateTestingCloudRun(
 config:PlaygroundMappedMysqlRehearsal,
 env:NodeJS.ProcessEnv=process.env,
){
 if(env.RAILWAY_ENVIRONMENT_NAME!=="Testing"||
  env.TESTING_CLOUD_TEN_FEED_APPROVED!=="YES_I_APPROVE")
  throw new Error("Explicit Railway Testing-only cloud rehearsal approval required");
 if(env.ENABLE_GOVERNED_SOURCE_CUTOVER==="true"||
  env.ENABLE_SEMANTIC_SHADOW_ENQUEUE==="true")
  throw new Error("Cloud rehearsal cannot activate cutover or semantic shadow workers");
 const db=env.DATABASE_URL??"";
 let parsed:URL;
 try{parsed=new URL(db);}catch{throw new Error("Isolated Neon Testing DATABASE_URL required");}
 if(!["postgres:","postgresql:"].includes(parsed.protocol)||
    !parsed.hostname.endsWith(".neon.tech")||
    !parsed.pathname.startsWith("/newchanges_testing_")||
    parsed.searchParams.get("sslmode")!=="require")
  throw new Error("Cloud rehearsal requires isolated Neon Testing database");
 if(!(env.SEMANTIC_S3_BUCKET??"").toLowerCase().includes("testing"))
  throw new Error("Cloud rehearsal requires a dedicated Testing object bucket");
 const mapping=validateCanonicalSchemaMapping(config.mapping);
 if(config.approvedForPlayground!==true||!mapping.valid)
  throw new Error("Approved complete canonical mapping required");
 if(config.source.user.trim().toLowerCase()==="root"||
   config.source.ssl!==true||config.source.rejectUnauthorized!==true)
  throw new Error("Restricted verified-TLS source required");
 if(!Number.isSafeInteger(config.pageSize)||config.pageSize<1||config.pageSize>250||
   !Number.isSafeInteger(config.maxRowsPerFeed)||config.maxRowsPerFeed<1||
   !Number.isSafeInteger(config.maxBytesPerFeed)||config.maxBytesPerFeed<1||
   !Number.isSafeInteger(config.maxPagesPerFeed)||config.maxPagesPerFeed<1||
   LOAD_ORDER.length*config.maxRowsPerFeed>config.maxTotalRows||
   LOAD_ORDER.length*config.maxBytesPerFeed>config.maxTotalBytes||
   LOAD_ORDER.length*config.maxPagesPerFeed>config.maxTotalPages)
  throw new Error("Invalid per-feed or aggregate Testing transfer reservation");
 if(!Number.isSafeInteger(config.maxTotalBytes)||config.maxTotalBytes<1||
   config.maxTotalBytes>64*1024*1024||
   !Number.isSafeInteger(config.maxTotalRows)||config.maxTotalRows<1||
   !Number.isSafeInteger(config.maxTotalPages)||config.maxTotalPages<1)
  throw new Error("Invalid bounded Testing transfer budget");
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(config.upperWatermark)||
   !Number.isFinite(Date.parse(config.upperWatermark)))
  throw new Error("Approved UTC source watermark required");
 const owner=env.TESTING_CLOUD_WORKER_ID??"testing_worker";
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(owner))
  throw new Error("Invalid fenced worker identity");
 return {database:parsed.pathname.slice(1),owner,
  networkBytes:Math.min(128*1024*1024,2*(config.maxTotalBytes+TEN_MIB))};
}

/** All results are metadata counts, never source rows or connection secrets. */
export async function rehearseCloudMappedMysqlImport(
 config:PlaygroundMappedMysqlRehearsal,env:NodeJS.ProcessEnv=process.env,
){
 const approved=validateTestingCloudRun(config,env);
 const {Client}=pg;
 const db=new Client({connectionString:env.DATABASE_URL,
  application_name:"newchanges_testing_cloud_rehearsal"});
 await db.connect();
 let source:Awaited<ReturnType<typeof openPlaygroundMysqlSnapshot>>|null=null;
 try{
  const identity=await db.query<{name:string}>("SELECT current_database() AS name");
  if(identity.rows[0]?.name!==approved.database)
   throw new Error("Neon connection is not the isolated Testing database");
  const table=await db.query<{exists:string|null}>(
   "SELECT to_regclass('staging_rehearsal.\"MappedStagingCheckpoint\"')::text AS exists");
  if(!table.rows[0]?.exists)
   throw new Error("Approved isolated staging checkpoint table has not been prepared");
  await db.query("SET search_path TO staging_rehearsal, public");
  const executor:StagingSqlExecutor={
   async query<T extends Record<string,unknown>>(sql:string,params:readonly unknown[]){
    const result=await db.query(sql,[...params]);
    return result.rows as T[];
   },
  };
  source=await openPlaygroundMysqlSnapshot(config.source);
  const schemas=[...new Set(config.mapping.feeds.map(f=>f.sourceTable.split(".")[0]))];
  const catalog:DiscoveryColumn[]=[];
  for(const schema of schemas)catalog.push(...await source.discoverColumns(schema));
  const reviewed=reviewMappingAgainstCatalog(config.mapping,catalog);
  if(!reviewed.validForSampleReview)
   throw new Error("Discovered source mapping does not match the approved catalogue");
  const recorders=new Map<string,Awaited<ReturnType<typeof createFencedCloudReceiptRecorder>>>();
  for(const feed of LOAD_ORDER)
   recorders.set(feed,await createFencedCloudReceiptRecorder(
    executor,config.mapping.sourceGeneration,feed,approved.owner,120));
  const http=createBoundedCloudStageHttp(15_000,env);
  const cloud=createIsolatedCloudPageSink(http,async(receipt:CloudPageReceipt)=>{
   const recorder=recorders.get(receipt.feed);
   if(!recorder)throw new Error("Cloud receipt feed is not approved");
   await recorder.recordReceipt(receipt);
  },env,2*1024*1024,approved.networkBytes);
  const evidence=createMappedStagingEvidenceSink(cloud.sink);
  const result=await extractTenMappedFeeds(feed=>({
    mapping:config.mapping,catalog,dialect:"MYSQL",feed,
    upperWatermark:config.upperWatermark,reader:source!,
    sink:evidence.sink,canonicalValidation:"strict",
    pageSize:config.pageSize,maxRows:config.maxRowsPerFeed,
    maxBytes:config.maxBytesPerFeed,maxPages:config.maxPagesPerFeed
   }),{maxTotalRows:config.maxTotalRows,maxTotalBytes:config.maxTotalBytes,
    maxTotalPages:config.maxTotalPages});
  return {
   generation:config.mapping.sourceGeneration,
   snapshotId:source.snapshotId,
   feeds:result.summaries.map(s=>({
    feed:s.feed,rowsStaged:s.rowsCommitted,pagesVerified:s.pagesCommitted,
    sourceBytes:s.bytesRead,
    // This digest is of committed canonical rows, not a source parity attestation.
    committedRowsSha256:evidence.finish().find(e=>e.feed===s.feed)!.committedRowsSha256,
    digestScope:"current-process-committed-pages" as const,
   })),
   productionEnabled:false as const,publicationEnabled:false as const,
  };
 }finally{
  if(source)await source.close().catch(()=>{});
  await db.end();
 }
}

