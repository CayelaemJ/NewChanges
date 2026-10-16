// Release preflight for source-agnostic ten-feed cutover.
// Proofs are supplied by independent, trusted verification jobs, not user UI.
// A green CI result is never evidence that a live source has been reconciled.
import {LOAD_ORDER} from "./reportFormats.js";

const hash=/^[0-9a-f]{64}$/;
const identifier=/^[A-Za-z0-9_-]{1,128}$/;
export interface FeedCutoverProof {
 feed:string; sourceRows:number; stagedRows:number; matchedRows:number;
 sourceDigest:string; stagedDigest:string; watermark:string;
}
export interface ProductionCutoverEvidence{
 candidateGeneration:string; activeGeneration:string;
 proofs:readonly FeedCutoverProof[];
 mappingReviewed:boolean; readOnlyCredentialsVerified:boolean;
 sourceSnapshotImmutableOrReplaySafe:boolean;
 cloudObjectReadbackVerified:boolean; cloudCheckpointsFenced:boolean;
 recoveryDrillPassed:boolean; rollbackDrillPassed:boolean;
 semanticParityVerified:boolean; tenantIsolationVerified:boolean;
 securityApproved:boolean; operatorApproved:boolean;
 sourceBytesTransferred:number; maximumSourceBytes:number;
 projectedNeonWriteBytes:number; maximumNeonWriteBytes:number;
 projectedNeonResidentBytes:number; maximumNeonResidentBytes:number;
 checkedAt:string; maxProofAgeMinutes?:number;
}
export function evaluateTenFeedCutover(e:ProductionCutoverEvidence,now=new Date()){
 const blockers:string[]=[];
 const validIdentity=(v:unknown)=>typeof v==="string"&&identifier.test(v);
 if(!validIdentity(e?.candidateGeneration)||!validIdentity(e?.activeGeneration)||
   e.candidateGeneration===e.activeGeneration)blockers.push("distinct active and candidate generations required");
 const guards=[
  ["mappingReviewed","approved business mapping"],
  ["readOnlyCredentialsVerified","restricted source account"],
  ["sourceSnapshotImmutableOrReplaySafe","restart-safe snapshot or CDC replay"],
  ["cloudObjectReadbackVerified","real cloud readback checksums"],
  ["cloudCheckpointsFenced","durable fenced cloud checkpoints"],
  ["recoveryDrillPassed","real crash/recovery rehearsal"],
  ["rollbackDrillPassed","transactional rollback rehearsal"],
  ["semanticParityVerified","semantic dashboard parity"],
  ["tenantIsolationVerified","tenant and permission isolation"],
  ["securityApproved","security approval"],
  ["operatorApproved","operator release approval"],
 ] as const;
 for(const [key,label] of guards)if(e?.[key]!==true)blockers.push("Missing "+label);
 if(!Array.isArray(e?.proofs)||e.proofs.length!==LOAD_ORDER.length)
  blockers.push("Exactly ten feed proofs are required");
 const observed=new Set<string>();
 for(const p of e?.proofs??[]){
  if(!p||!LOAD_ORDER.includes(p.feed)||observed.has(p.feed)){
   blockers.push("Unknown or duplicate feed proof");continue;
  }
  observed.add(p.feed);
  if(![p.sourceRows,p.stagedRows,p.matchedRows].every(v=>Number.isSafeInteger(v)&&v>=0)||
    p.sourceRows!==p.stagedRows||p.sourceRows!==p.matchedRows)
   blockers.push(p.feed+": source/staged/reconciled row totals differ");
  if(!hash.test(p.sourceDigest)||p.sourceDigest!==p.stagedDigest)
   blockers.push(p.feed+": source and staged digests differ");
  const sourceTime=Date.parse(p.watermark);
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(p.watermark)||
    !Number.isFinite(sourceTime)||sourceTime>now.getTime())
   blockers.push(p.feed+": invalid source watermark");
 }
 for(const feed of LOAD_ORDER)if(!observed.has(feed))blockers.push(feed+": missing feed reconciliation");
 const budgets=[
  ["sourceBytesTransferred","maximumSourceBytes","source transfer budget"],
  ["projectedNeonWriteBytes","maximumNeonWriteBytes","Neon write budget"],
  ["projectedNeonResidentBytes","maximumNeonResidentBytes","Neon resident budget"],
 ] as const;
 for(const [actual,limit,label] of budgets){
  const a=e?.[actual],b=e?.[limit];
  if(!Number.isSafeInteger(a)||a<0||!Number.isSafeInteger(b)||b<1||a>b)
   blockers.push("Unverified or exceeded "+label);
 }
 const checked=Date.parse(e?.checkedAt??"");
 const maxMinutes=e?.maxProofAgeMinutes??60;
 if(!Number.isSafeInteger(maxMinutes)||maxMinutes<1||maxMinutes>60||
    !Number.isFinite(checked)||checked>now.getTime()||
    now.getTime()-checked>maxMinutes*60_000)
  blockers.push("Fresh release evidence is required");
 return {readyForProduction: blockers.length===0,blockers,
  permittedActions: blockers.length===0?["request separately approved cutover"]:[],
  cutoverExecuted:false as const,productionDataModified:false as const};
}
