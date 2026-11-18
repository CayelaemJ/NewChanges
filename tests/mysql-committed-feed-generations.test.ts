import assert from "node:assert/strict";
import {test} from "node:test";
import {LOAD_ORDER} from "../src/services/reportFormats.js";
import {
  diffCommittedFeedGenerations,verifyFeedInvalidation,
  type DurableFeedGenerations,
} from "../src/services/mysqlCommittedFeedGenerations.js";

const snapshot=(checkpointGeneration:number,journeys:number,employees=0):DurableFeedGenerations=>({
  sourceId:"ingest_stage_rds",checkpointGeneration,
  feeds:Object.fromEntries(LOAD_ORDER.map(feed=>[feed,feed==="journeys"?journeys:
    feed==="employees"?employees:0])),
});

test("durable feed changes emit only affected canonical feeds with no employer identifier",()=>{
  const changes=diffCommittedFeedGenerations(snapshot(1,1),snapshot(3,2,1));
  assert.deepEqual(changes,[
    {type:"MYSQL_FEED_INVALIDATION",feed:"employees",generation:1},
    {type:"MYSQL_FEED_INVALIDATION",feed:"journeys",generation:2},
  ]);
  assert(changes.every(verifyFeedInvalidation));
  assert(!JSON.stringify(changes).includes("employer"));
  assert(!JSON.stringify(changes).includes("tenant"));
});

test("same checkpoint and generations emit nothing",()=>{
  assert.deepEqual(diffCommittedFeedGenerations(snapshot(1,1),snapshot(1,1)),[]);
});

test("new checkpoint without changes does not fabricate feed activity",()=>{
  assert.deepEqual(diffCommittedFeedGenerations(snapshot(1,0),snapshot(2,0)),[]);
});

test("source switch and checkpoint regression fail closed",()=>{
  assert.throws(()=>diffCommittedFeedGenerations(snapshot(5,2),
    {...snapshot(6,3),sourceId:"other"}),/SOURCE_OR_CHECKPOINT_REGRESSION/);
  assert.throws(()=>diffCommittedFeedGenerations(snapshot(5,2),snapshot(4,2)),
    /SOURCE_OR_CHECKPOINT_REGRESSION/);
});

test("feed regression and unauthorized feed names fail closed",()=>{
  assert.throws(()=>diffCommittedFeedGenerations(snapshot(5,2),snapshot(6,1)),
    /CDC_FEED_GENERATION_REGRESSION/);
  const malformed={...snapshot(5,1),feeds:{...snapshot(5,1).feeds,users:1}};
  assert.throws(()=>diffCommittedFeedGenerations(snapshot(5,1),malformed),
    /CDC_FEED_GENERATION_SNAPSHOT_INVALID/);
});

test("invalid or incomplete snapshots cannot create notifications",()=>{
  const base=snapshot(5,1);
  for(const bad of [
    {...base,feeds:{journeys:1}},
    {...base,checkpointGeneration:-1},
    {...base,feeds:{...base.feeds,journeys:99}},
    {...base,feeds:{...base.feeds,journeys:1.5}},
  ])assert.throws(()=>diffCommittedFeedGenerations(base,bad),
    /CDC_FEED_GENERATION_SNAPSHOT_INVALID/);
});

test("consumer rejects employer-specific or unallowlisted notification envelopes",()=>{
  assert.equal(verifyFeedInvalidation({type:"MYSQL_FEED_INVALIDATION",
    feed:"journeys",generation:1}),true);
  for(const bad of [
    {type:"MYSQL_FEED_INVALIDATION",feed:"journeys",generation:1,employerRef:"VIG"},
    {type:"MYSQL_FEED_INVALIDATION",feed:"mysql_users",generation:1},
    {type:"MYSQL_FEED_INVALIDATION",feed:"journeys",generation:0},
    {type:"MYSQL_CHART_INVALIDATION",feed:"journeys",generation:1},
  ]) assert.equal(verifyFeedInvalidation(bad),false);
});
