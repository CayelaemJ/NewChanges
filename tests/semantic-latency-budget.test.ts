import assert from "node:assert/strict";
import { sourceChangePollSeconds } from "../src/services/sourceChangePollConfig.js";
import { semanticBrowserPollSeconds, estimateSemanticRefreshLatency } from "../src/services/semanticLatencyBudget.js";

assert.equal(sourceChangePollSeconds({}),60);
assert.equal(sourceChangePollSeconds({SOURCE_CHANGE_POLL_SECONDS:"15"}),30,"Fast source watch must default off");
assert.equal(sourceChangePollSeconds({SOURCE_CHANGE_POLL_SECONDS:"15",ENABLE_SEMANTIC_FAST_SOURCE_WATCH:"true"}),15);
assert.equal(sourceChangePollSeconds({SOURCE_CHANGE_POLL_SECONDS:"10",ENABLE_SEMANTIC_FAST_SOURCE_WATCH:"true"}),15);
assert.equal(sourceChangePollSeconds({SOURCE_CHANGE_POLL_SECONDS:"15",ENABLE_SEMANTIC_FAST_SOURCE_WATCH:"true",STANDBY_MODE:"true"}),30);
assert.equal(semanticBrowserPollSeconds({}),0,"Semantic notifications default off");
assert.equal(semanticBrowserPollSeconds({ENABLE_SEMANTIC_LIVE_NOTIFICATIONS:"true"}),30);
assert.equal(semanticBrowserPollSeconds({ENABLE_SEMANTIC_FAST_DASHBOARD_POLL:"true"}),0,"Fast browser polling cannot turn on notifications");
assert.equal(semanticBrowserPollSeconds({ENABLE_SEMANTIC_LIVE_NOTIFICATIONS:"true",ENABLE_SEMANTIC_FAST_DASHBOARD_POLL:"true"}),15);
assert.equal(semanticBrowserPollSeconds({ENABLE_SEMANTIC_LIVE_NOTIFICATIONS:"true",ENABLE_SEMANTIC_FAST_DASHBOARD_POLL:"true",STANDBY_MODE:"true"}),30);

const stages={sourceWatchMs:60_000,ingestionMs:5_000,workerWakeMs:60_000,
  recomputeMs:10_000,storageAndPublishMs:3_000,browserPollMs:30_000,networkMs:2_000};
const normal=estimateSemanticRefreshLatency(stages);
assert.equal(normal.withinBudget,false,"Current default schedule cannot promise 60-second updates");
assert.equal(normal.upperBoundMs,170_000);
const fast=estimateSemanticRefreshLatency({
  ...stages,sourceWatchMs:15_000,workerWakeMs:1_000,browserPollMs:15_000,
});
assert.equal(fast.upperBoundMs,51_000);
assert.equal(fast.withinBudget,true);
assert.equal(fast.measured,false,"Synthetic estimates cannot claim measured acceptance");
const slowRebuild=estimateSemanticRefreshLatency({...stages,sourceWatchMs:15_000,workerWakeMs:1_000,
  browserPollMs:15_000,recomputeMs:25_000});
assert.equal(slowRebuild.withinBudget,false,"A slow real recomputation must fail budget");
for(const field of ["sourceWatchMs","ingestionMs","workerWakeMs",
  "recomputeMs","storageAndPublishMs","browserPollMs","networkMs"] as const){
  assert.throws(()=>estimateSemanticRefreshLatency({...stages,[field]:-1}),/nonnegative/);
}
console.log("Semantic 60-second latency budget and expensive-opt-in polling controls passed");
