// Pure opt-in polling and conservative upper-bound latency math.
// An estimate is NOT evidence of measured SQL-source-to-browser delivery.
export function semanticBrowserPollSeconds(env:NodeJS.ProcessEnv=process.env):number {
  if(env.ENABLE_SEMANTIC_LIVE_NOTIFICATIONS!=="true") return 0;
  return env.ENABLE_SEMANTIC_FAST_DASHBOARD_POLL==="true" && env.STANDBY_MODE!=="true" ? 15 : 30;
}
export type SemanticLatencyComponents = {
  sourceWatchMs:number;ingestionMs:number;workerWakeMs:number;
  recomputeMs:number;storageAndPublishMs:number;browserPollMs:number;networkMs:number;
};
export function estimateSemanticRefreshLatency(input:SemanticLatencyComponents,targetMs=60_000){
  const components=Object.values(input);
  if(components.some(v=>!Number.isFinite(v)||v<0) || !Number.isFinite(targetMs)||targetMs<=0)
    throw new Error("Latency budget requires finite nonnegative stage durations");
  const upperBoundMs=components.reduce((a,b)=>a+b,0);
  return {upperBoundMs,targetMs,remainingMs:targetMs-upperBoundMs,
    withinBudget:upperBoundMs<=targetMs,measured:false as const};
}
