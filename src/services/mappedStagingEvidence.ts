// Evidence for exactly the canonical rows acknowledged by a staging sink.
// A per-run receipt is not an independent source reconciliation proof.
// For recovery across processes the durable object ledger must be replayed.
import {createHash} from "node:crypto";
import type {MappedStagingSink} from "./canonicalMappedStagingRunner.js";
import {LOAD_ORDER} from "./reportFormats.js";

export interface StagedFeedEvidence {
 feed:string;
 generation:string;
 snapshotId:string;
 rowsCommitted:number;
 pagesCommitted:number;
 canonicalBytes:number;
 committedRowsSha256:string;
 digestScope:"current-process-committed-pages";
}
export function createMappedStagingEvidenceSink(delegate:MappedStagingSink){
 const states=new Map<string,{generation:string;snapshotId:string;rows:number;pages:number;bytes:number;hash:ReturnType<typeof createHash>}>();
 const sink:MappedStagingSink={async commitPage(page){
  if(!LOAD_ORDER.includes(page.feed)||!Array.isArray(page.rows)||page.rows.length<1)
   throw new Error("Invalid canonical evidence page");
  const evidenceRows=page.rows.map(r=>Buffer.from(JSON.stringify(r),"utf8"));
  const canonicalBytes=evidenceRows.reduce((sum,row)=>sum+row.byteLength,0);
  const digest=createHash("sha256").update(JSON.stringify(page.rows)).digest("hex");
  if(digest!==page.pageDigest)throw new Error("Canonical page digest mismatch before staging");
  const prev=states.get(page.feed);
  if(prev&&(prev.generation!==page.generation||prev.snapshotId!==page.snapshotId))
   throw new Error("Reconciliation evidence cannot mix source generations or snapshots");
  // Only acknowledge evidence after the underlying upload/readback and
  // durable fenced checkpoint transaction has succeeded.
  await delegate.commitPage(page);
  const state=prev??{generation:page.generation,snapshotId:page.snapshotId,
   rows:0,pages:0,bytes:0,hash:createHash("sha256")};
  for(const row of evidenceRows){
   const length=Buffer.alloc(4);
   length.writeUInt32BE(row.byteLength);
   state.hash.update(length).update(row);
  }
  state.rows+=page.rows.length;
  state.pages++;
  state.bytes+=canonicalBytes;
  states.set(page.feed,state);
 }};
 return {
  sink,
  finish():StagedFeedEvidence[]{
   return LOAD_ORDER.map(feed=>{
    const state=states.get(feed);
    const empty=createHash("sha256").digest("hex");
    return {feed,generation:state?.generation??"",
     snapshotId:state?.snapshotId??"",rowsCommitted:state?.rows??0,
     pagesCommitted:state?.pages??0,canonicalBytes:state?.bytes??0,
     committedRowsSha256:state?.hash.copy().digest("hex")??empty,
     digestScope:"current-process-committed-pages" as const};
   });
  }
 };
}
