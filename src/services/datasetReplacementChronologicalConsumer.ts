// Opt-in staging-only keyset consumer. Never publishes, deletes or switches sources.
// The reader must pin one immutable snapshot and order by (source_updated_at, natural key).
import {LOAD_ORDER,getFormat} from "./reportFormats.js";

export type ChronologicalCursor={updatedAt:string; naturalKey:string};
export type ChronologicalRow={cursor:ChronologicalCursor; payload:Record<string,unknown>};
export type ChronologicalPage={snapshotId:string; rows:readonly ChronologicalRow[]};
export type ChronologicalCaps={maxRowsPerPage:number;maxTotalRows:number;maxTotalBytes:number;maxPages:number};
export interface ChronologicalFeedPlan {
 feed:string; generationId:string; snapshotId:string; after:ChronologicalCursor|null; caps:ChronologicalCaps;
 readPage:(after:ChronologicalCursor|null,limit:number,snapshotId:string)=>Promise<ChronologicalPage>;
 commitPage:(rows:readonly ChronologicalRow[],last:ChronologicalCursor)=>Promise<void>;
 saveCheckpoint:(last:ChronologicalCursor)=>Promise<void>;
}
function validCursor(c:ChronologicalCursor):boolean {
 return typeof c?.naturalKey==="string"&&c.naturalKey.length>0&&c.naturalKey.length<=2048&&
  typeof c.updatedAt==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(c.updatedAt)&&
  Number.isFinite(Date.parse(c.updatedAt));
}
function compare(a:ChronologicalCursor,b:ChronologicalCursor):number{
 const x=Date.parse(a.updatedAt),y=Date.parse(b.updatedAt);
 return x===y?(a.naturalKey<b.naturalKey?-1:a.naturalKey>b.naturalKey?1:0):x<y?-1:1;
}
/** Fixed snapshot + stable timestamp/key ordering; idempotent commit is mandatory. */
export async function consumeChronologicalFeed(plan:ChronologicalFeedPlan){
 const c=plan.caps;
 if(!LOAD_ORDER.includes(plan.feed)||!getFormat(plan.feed)||
    !/^[A-Za-z0-9_-]{1,128}$/.test(plan.generationId)||
    !/^[A-Za-z0-9_-]{1,128}$/.test(plan.snapshotId)||
    (plan.after!==null&&!validCursor(plan.after))||
    !Number.isSafeInteger(c.maxRowsPerPage)||c.maxRowsPerPage<1||c.maxRowsPerPage>1000||
    !Number.isSafeInteger(c.maxTotalRows)||c.maxTotalRows<1||
    !Number.isSafeInteger(c.maxTotalBytes)||c.maxTotalBytes<1||
    !Number.isSafeInteger(c.maxPages)||c.maxPages<1)
  throw new Error("Invalid chronological staging plan");
 let after=plan.after,rows=0,bytes=0,pages=0;
 while(true){
  // A one-row lookahead distinguishes exactly-full feeds from truncated feeds.
  // The probe is never committed and stays within a bounded single-row read.
  const exhausted=pages>=c.maxPages||rows>=c.maxTotalRows;
  const limit=exhausted?1:Math.min(c.maxRowsPerPage,c.maxTotalRows-rows);
  const page=await plan.readPage(after,limit,plan.snapshotId);
  if(page.snapshotId!==plan.snapshotId||!Array.isArray(page.rows)||page.rows.length>limit)
   throw new Error("Invalid page or source snapshot changed");
  if(page.rows.length===0)break;
  if(exhausted)throw new Error("Row or page budget exhausted before end of feed");
  let previous=after,added=0;
  for(const row of page.rows){
   if(!validCursor(row.cursor)||(previous!==null&&compare(row.cursor,previous)<=0))
    throw new Error("Chronological cursor missing, duplicated or out of order");
   const payload=JSON.stringify(row.payload);
   if(typeof payload!=="string")throw new Error("Missing row payload");
   added+=Buffer.byteLength(payload,"utf8");
   if(!Number.isSafeInteger(added)||added>c.maxTotalBytes-bytes)
    throw new Error("Transfer byte budget exceeded before write");
   previous=row.cursor;
  }
  const last=previous!;
  await plan.commitPage(page.rows,last);
  // Checkpoint only AFTER durable writes; replay must be idempotent if this fails.
  await plan.saveCheckpoint(last);
  after=last;rows+=page.rows.length;bytes+=added;pages++;
 }
 return {feed:plan.feed,rowsCommitted:rows,bytesRead:bytes,pagesCommitted:pages,
  lastCheckpoint:after,publicationEnabled:false as const};
}
/** Dependency barriers: later feeds never execute until earlier feeds have completed. */
export async function consumeCanonicalChronologically(
 plans:readonly ChronologicalFeedPlan[],
 onFeedComplete?:(feed:string)=>Promise<void>,
){
 if(plans.length!==LOAD_ORDER.length||plans.some((p,i)=>p.feed!==LOAD_ORDER[i]))
  throw new Error("Ten canonical feeds must follow dependency load order");
 const summaries=[];
 for(const plan of plans){
  const summary=await consumeChronologicalFeed(plan);
  await onFeedComplete?.(plan.feed);
  summaries.push(summary);
 }
 return {summaries,publicationEnabled:false as const};
}
