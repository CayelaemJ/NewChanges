// Read-only cost and capacity gate for planning ten-feed replacement.
// Never equate source row count with Neon storage; these are conservative
// scenario estimates, not an invoice or permission to execute a migration.
import {LOAD_ORDER} from "./reportFormats.js";

export interface FeedTransferEstimate {
  reportKey:string;
  rows:number;
  averageBytesPerRow:number;
  changedRows:number;
}
export interface TransferCaps {
  maxSourceReadBytes:number;
  maxNeonWriteBytes:number;
  maxNeonResidentBytes:number;
  // Explicit amplification accounts for indexes, versions and write-ahead logging.
  neonWriteAmplification:number;
  neonResidentAmplification:number;
}
const MAX_SAFE=Number.MAX_SAFE_INTEGER;
function validInteger(n:number,minimum=0):boolean {
  return Number.isSafeInteger(n)&&n>=minimum;
}
function safeMultiply(a:number,b:number):number|null {
  const n=a*b;
  return Number.isSafeInteger(n)&&n>=0?n:null;
}
function safeAdd(a:number,b:number):number|null {
  const n=a+b;
  return Number.isSafeInteger(n)&&n>=0?n:null;
}
export function reviewTenFeedTransferBudget(feeds:readonly FeedTransferEstimate[],caps:TransferCaps) {
  const issues:string[]=[];
  const invalidCaps=!validInteger(caps.maxSourceReadBytes,1)||
    !validInteger(caps.maxNeonWriteBytes,1)||
    !validInteger(caps.maxNeonResidentBytes,1)||
    !Number.isFinite(caps.neonWriteAmplification)||caps.neonWriteAmplification<1||
    !Number.isFinite(caps.neonResidentAmplification)||caps.neonResidentAmplification<1;
  if(invalidCaps)issues.push("Invalid transfer or Neon storage caps");
  const seen=new Set<string>();
  let sourceBytes=0,changedBytes=0;
  if(feeds.length!==LOAD_ORDER.length)issues.push("Expected exactly ten canonical feeds");
  for(const feed of feeds){
    if(!LOAD_ORDER.includes(feed.reportKey as (typeof LOAD_ORDER)[number]))
      issues.push("Unknown canonical feed");
    if(seen.has(feed.reportKey))issues.push("Duplicate canonical feed: "+feed.reportKey);
    seen.add(feed.reportKey);
    if(!validInteger(feed.rows)||!validInteger(feed.changedRows)||
       feed.changedRows>feed.rows||!validInteger(feed.averageBytesPerRow,1)) {
      issues.push("Invalid feed estimate: "+feed.reportKey);
      continue;
    }
    const total=safeMultiply(feed.rows,feed.averageBytesPerRow);
    const delta=safeMultiply(feed.changedRows,feed.averageBytesPerRow);
    if(total===null||delta===null){
      issues.push("Feed estimate exceeds safe integer range: "+feed.reportKey);
      continue;
    }
    const nextTotal=safeAdd(sourceBytes,total),nextDelta=safeAdd(changedBytes,delta);
    if(nextTotal===null||nextDelta===null)issues.push("Aggregate estimate exceeds safe integer range");
    else {sourceBytes=nextTotal;changedBytes=nextDelta;}
  }
  for(const key of LOAD_ORDER)if(!seen.has(key))issues.push("Missing canonical feed: "+key);
  // Incremental source reads may be bounded to changed rows ONLY after the
  // source has proven usable watermarks/change tracking and deletion handling.
  const projectedNeonWriteBytes=invalidCaps?null:safeMultiply(changedBytes,caps.neonWriteAmplification);
  const projectedNeonResidentBytes=invalidCaps?null:safeMultiply(changedBytes,caps.neonResidentAmplification);
  if(!invalidCaps&&(projectedNeonWriteBytes===null||projectedNeonResidentBytes===null))
    issues.push("Amplified Neon estimate exceeds safe integer range");
  if(!invalidCaps){
    if(sourceBytes>caps.maxSourceReadBytes)issues.push("Full source transfer exceeds approved read budget");
    if(projectedNeonWriteBytes!==null&&projectedNeonWriteBytes>caps.maxNeonWriteBytes)
      issues.push("Projected Neon writes exceed approved budget");
    if(projectedNeonResidentBytes!==null&&projectedNeonResidentBytes>caps.maxNeonResidentBytes)
      issues.push("Projected Neon resident storage exceeds approved budget");
  }
  return {
    approvedForExecution:false as const,
    withinPlanningBudget:issues.length===0,
    issues,
    fullSourceReadBytes:sourceBytes,
    changedPayloadBytes:changedBytes,
    projectedNeonWriteBytes,
    projectedNeonResidentBytes,
    note:"Planning only. Historical data, deletions, snapshots, query cost, network pricing and actual WAL usage require measured source/Neon evidence.",
  };
}
