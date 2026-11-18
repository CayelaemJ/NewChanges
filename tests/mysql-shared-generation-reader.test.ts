import assert from "node:assert/strict";
import {test} from "node:test";
import {LOAD_ORDER} from "../src/services/reportFormats.js";
import {
  readCommittedFeedSnapshot, SHARED_GENERATION_SQL,
  type GenerationReadConnection,
} from "../src/services/mysqlSharedGenerationReader.js";

function mocked(options?:{
  checkpoint?:unknown;feeds?:unknown;failOn?:string;failRollback?:boolean;
}){
  const sqls:string[]=[];
  const params:unknown[][]=[];
  let ended=0;
  const feeds=options?.feeds??LOAD_ORDER.map(feed=>({
    feed,generation:feed==="journeys"?"3":"0",
  }));
  const conn:GenerationReadConnection={
    async query({sql},p){
      sqls.push(sql);params.push(p);
      if(options?.failOn && sql.includes(options.failOn))throw Error("RDS_PRIVATE_CONNECTION_STRING");
      if(options?.failRollback && sql==="ROLLBACK")throw Error("RDS_PRIVATE_ROLLBACK");
      if(sql===SHARED_GENERATION_SQL.checkpoint)
        return [options?.checkpoint??[{generation:"3"}],[]];
      if(sql===SHARED_GENERATION_SQL.feeds)return [feeds,[]];
      return [[],[]];
    },
    async end(){ended++;},
  };
  return {conn,sqls,params,ended:()=>ended};
}

test("one read-only consistent snapshot yields canonical 10-feed inventory",async()=>{
  const mock=mocked();
  const snapshot=await readCommittedFeedSnapshot(async()=>mock.conn,"ingest_stage_rds");
  assert.equal(snapshot.checkpointGeneration,3);
  assert.equal(snapshot.feeds.journeys,3);
  assert.equal(snapshot.feeds.employees,0);
  assert.equal(Object.keys(snapshot.feeds).length,10);
  assert.deepEqual(mock.sqls,[
    "START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY",
    SHARED_GENERATION_SQL.checkpoint,SHARED_GENERATION_SQL.feeds,"ROLLBACK",
  ]);
  assert.deepEqual(mock.params[1],["ingest_stage_rds"]);
  assert.deepEqual(mock.params[2],["ingest_stage_rds"]);
  assert(!mock.sqls.some(s=>/(?:INSERT|UPDATE|DELETE|CREATE|DROP)\s/i.test(s)));
  assert.equal(mock.ended(),1);
});

test("unknown, missing, duplicated or extra feeds fail without publication",async()=>{
  for(const feeds of [
    [{feed:"journeys",generation:1}],
    [...LOAD_ORDER.map(feed=>({feed,generation:0})),{feed:"unknown",generation:0}],
    [...LOAD_ORDER.slice(0,9).map(feed=>({feed,generation:0})),{feed:"journeys",generation:0}],
  ]){
    const mock=mocked({feeds});
    await assert.rejects(readCommittedFeedSnapshot(async()=>mock.conn,"ingest_stage_rds"),
      /CDC_SHARED_GENERATION_READ_UNAVAILABLE/);
    assert.equal(mock.ended(),1);
    assert.equal(mock.sqls.at(-1),"ROLLBACK");
  }
});

test("checkpoint must be unique and all feed generations no newer than checkpoint",async()=>{
  for(const checkpoint of [
    [],[{generation:3},{generation:3}],[{generation:"NaN"}],[{generation:2**54}],
  ]){
    const mock=mocked({checkpoint});
    await assert.rejects(readCommittedFeedSnapshot(async()=>mock.conn,"ingest_stage_rds"));
    assert.equal(mock.ended(),1);
  }
  const mock=mocked({checkpoint:[{generation:2}]});
  await assert.rejects(readCommittedFeedSnapshot(async()=>mock.conn,"ingest_stage_rds"));
});

test("driver errors are redacted; failed read performs rollback and closes",async()=>{
  const mock=mocked({failOn:"cdc_feed_generation"});
  await assert.rejects(readCommittedFeedSnapshot(async()=>mock.conn,"ingest_stage_rds"),
    error=>error instanceof Error &&
      error.message==="CDC_SHARED_GENERATION_READ_UNAVAILABLE" &&
      !error.message.includes("PRIVATE"));
  assert.equal(mock.ended(),1);
  assert.equal(mock.sqls.at(-1),"ROLLBACK");
});

test("failed rollback cannot publish apparent success",async()=>{
  const mock=mocked({failRollback:true});
  await assert.rejects(readCommittedFeedSnapshot(async()=>mock.conn,"ingest_stage_rds"),
    /CDC_SHARED_GENERATION_READ_UNAVAILABLE/);
  assert.equal(mock.ended(),1);
});

test("source IDs and timeouts are validated before connecting",async()=>{
  let connects=0;
  const connect=async()=>{connects++;return mocked().conn;};
  for(const source of ["","invalid source","../data","a","x".repeat(101)]){
    await assert.rejects(readCommittedFeedSnapshot(connect,source),
      /CDC_SHARED_READER_CONFIG_INVALID/);
  }
  for(const timeout of [0,100,10001,NaN]){
    await assert.rejects(readCommittedFeedSnapshot(connect,"ingest_stage_rds",timeout));
  }
  assert.equal(connects,0);
});
