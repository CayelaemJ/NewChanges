// Process-local, secret-free source watcher heartbeat.
// This reports THIS worker's scheduler, not cross-instance availability.
export type SourceWatchOutcome="UNCHANGED"|"CHANGED"|"SYNC_OK"|"SYNC_FAILED"|"FALLBACK"|"DISABLED"|"ERROR"|"UNSUPPORTED";
export interface SourceWatchHealth{
 lastCheckedAt:string|null;
 lastChangeDetectedAt:string|null;
 lastSuccessfulSyncAt:string|null;
 lastFailureAt:string|null;
 lastOutcome:SourceWatchOutcome|null;
 lastDurationMs:number|null;
 lastChangedFeeds:number;
 lastErrorClass:string|null;
 pollCount:number;
}
const initial=():SourceWatchHealth=>({
 lastCheckedAt:null,lastChangeDetectedAt:null,lastSuccessfulSyncAt:null,
 lastFailureAt:null,lastOutcome:null,lastDurationMs:null,
 lastChangedFeeds:0,lastErrorClass:null,pollCount:0,
});
let state:SourceWatchHealth=initial();
export function readSourceWatchHealth():SourceWatchHealth{return {...state};}
export function recordSourceWatch(input:{
 outcome:SourceWatchOutcome;
 durationMs:number;
 changedFeeds?:number;
 at?:Date;
 errorClass?:string;
}):void{
 const at=input.at??new Date();
 if(!Number.isFinite(at.getTime())||
    !Number.isFinite(input.durationMs)||input.durationMs<0||
    !Number.isSafeInteger(input.changedFeeds??0)||(input.changedFeeds??0)<0)
  throw new Error("Invalid source watcher telemetry");
 const iso=at.toISOString();
 state={
  ...state,lastCheckedAt:iso,lastOutcome:input.outcome,
  lastDurationMs:Math.round(input.durationMs),
  lastChangedFeeds:input.changedFeeds??0,
  lastErrorClass:input.outcome==="ERROR"?
    (input.errorClass==="TIMEOUT"?"TIMEOUT":"SOURCE_PROBE_ERROR"):null,
  pollCount:state.pollCount+1,
  ...(input.outcome==="CHANGED"||input.outcome==="SYNC_OK"
    ?{lastChangeDetectedAt:iso}:{}),
  ...(input.outcome==="SYNC_OK"||input.outcome==="FALLBACK"
    ?{lastSuccessfulSyncAt:iso}:{}),
  ...(input.outcome==="ERROR"||input.outcome==="SYNC_FAILED"
    ?{lastFailureAt:iso}:{}),
 };
}
// For isolated tests; must never be called from HTTP endpoints.
export function resetSourceWatchHealthForTest(){state=initial();}
export function sourceWatchPublicStatus(
 enabled:boolean,pollSeconds:number,now=new Date(),
){
 const observation=readSourceWatchHealth();
 const lastCheckAgeSeconds=observation.lastCheckedAt?
   Math.max(0,Math.floor((now.getTime()-Date.parse(observation.lastCheckedAt))/1000)):null;
 const overdue=enabled&&(lastCheckAgeSeconds===null||
    lastCheckAgeSeconds>Math.max(pollSeconds*3,120));
 return {
  ...observation,
  schedulerConfigured:enabled,
  observerScope:"this-process" as const,
  intervalSeconds:pollSeconds,
  lastCheckAgeSeconds,
  status:!enabled?"PAUSED" as const:
    overdue?"STALE" as const:
    observation.lastOutcome==="ERROR"||observation.lastOutcome==="SYNC_FAILED"
       ?"DEGRADED" as const:"RUNNING" as const,
 };
}
