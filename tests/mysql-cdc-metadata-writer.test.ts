import assert from "node:assert/strict";
import {test} from "node:test";
import {planCommittedCdcWrite} from "../src/services/mysqlCdcCommitPlan.js";
import {commitCdcMetadata,CDC_METADATA_SQL,type CdcMetadataConnection} from "../src/services/mysqlCdcMetadataWriter.js";

const digest="a".repeat(64);
const plan=()=>planCommittedCdcWrite({
  sourceId:"source_rds",binlogFile:"mysql-bin.000055",binlogPosition:700,
  expectedGeneration:5,affectedFeeds:["journeys","employees"],
  commitDigest:digest,xidVerified:true,leaderEpoch:8,
});
function fake(opts:{
  locked?:unknown;found?:unknown;fail?:string;affected?:Record<string,number>;
}={}){
  const sqls:string[]=[], params:unknown[][]=[];
  let ended=0;
  const conn:CdcMetadataConnection={
    async query({sql},args){
      sqls.push(sql);params.push(args);
      if(opts.fail===sql)throw Error("PRIVATE_MYSQL_SQL_AND_PASSWORD");
      if(sql===CDC_METADATA_SQL.LOCK)return [opts.locked??[{
        binlog_file:"mysql-bin.000055",binlog_position:500,generation:5,fence_epoch:8,
      }],[]];
      if(sql===CDC_METADATA_SQL.FIND)return [opts.found??[],[]];
      if([CDC_METADATA_SQL.INSERT,CDC_METADATA_SQL.BUMP,
          CDC_METADATA_SQL.CHECKPOINT].includes(sql)){
        return [{affectedRows:opts.affected?.[sql]??1},[]];
      }
      return [[],[]];
    },
    async end(){ended++;},
  };
  return {conn,sqls,params,ended:()=>ended};
}

test("valid committed XID plan is canonical and has bounded feeds",()=>{
  const p=plan();
  assert.equal(p.nextGeneration,6);
  assert.deepEqual(p.affectedFeeds,["employees","journeys"]);
  assert(Object.isFrozen(p));
  assert(Object.isFrozen(p.affectedFeeds));
});

test("reject unverified XID, source, digest, stale counters and duplicate feeds before connecting",async()=>{
  let connected=0;
  const connector=async()=>{connected++;return fake().conn;};
  const base={sourceId:"source_rds",binlogFile:"mysql-bin.000055",
    binlogPosition:700,expectedGeneration:5,affectedFeeds:["journeys"],
    commitDigest:digest,xidVerified:true as const,leaderEpoch:8};
  for(const candidate of [
    {...base,xidVerified:false},
    {...base,sourceId:"../bad"},
    {...base,commitDigest:"short"},
    {...base,leaderEpoch:0},
    {...base,affectedFeeds:["journeys","journeys"]},
    {...base,affectedFeeds:["noncanonical"]},
    {...base,expectedGeneration:Number.MAX_SAFE_INTEGER},
  ])assert.throws(()=>planCommittedCdcWrite(candidate as typeof base),
    /CDC_META_COMMIT_INTENT_INVALID/);
  await assert.rejects(commitCdcMetadata(connector,{...plan(),leaderEpoch:0}),
    /CDC_META_WRITE_CONFIG_INVALID/);
  assert.equal(connected,0);
});

test("one InnoDB transaction persists digest, two feeds and checkpoint then commits",async()=>{
  const m=fake();
  assert.equal(await commitCdcMetadata(async()=>m.conn,plan()),"COMMITTED");
  assert.deepEqual(m.sqls,[
    CDC_METADATA_SQL.START,CDC_METADATA_SQL.LOCK,CDC_METADATA_SQL.FIND,
    CDC_METADATA_SQL.INSERT,CDC_METADATA_SQL.BUMP,CDC_METADATA_SQL.BUMP,
    CDC_METADATA_SQL.CHECKPOINT,CDC_METADATA_SQL.COMMIT,
  ]);
  assert.deepEqual(m.params[1],["source_rds"]);
  assert.deepEqual(m.params[4],["source_rds","employees"]);
  assert.deepEqual(m.params[5],["source_rds","journeys"]);
  assert.deepEqual(m.params[6],["mysql-bin.000055",700,"source_rds",5,8]);
  assert.equal(m.ended(),1);
  assert(!m.sqls.some(sql=>sql.includes("postgres")||sql.includes("ingest_stage.")));
});

test("identical replay with same durable digest does not bump any feed",async()=>{
  const m=fake({found:[{digest}]});
  assert.equal(await commitCdcMetadata(async()=>m.conn,plan()),"REPLAYED");
  assert.deepEqual(m.sqls,[
    CDC_METADATA_SQL.START,CDC_METADATA_SQL.LOCK,CDC_METADATA_SQL.FIND,
    CDC_METADATA_SQL.ROLLBACK,
  ]);
  assert.equal(m.ended(),1);
});

test("conflicting replay, stale checkpoint and wrong leader all roll back",async()=>{
  const cases=[
    {found:[{digest:"b".repeat(64)}]},
    {locked:[{binlog_file:"mysql-bin.000055",binlog_position:500,
      generation:6,fence_epoch:8}]},
    {locked:[{binlog_file:"mysql-bin.000055",binlog_position:500,
      generation:5,fence_epoch:7}]},
    {locked:[{binlog_file:"mysql-bin.000055",binlog_position:900,
      generation:5,fence_epoch:8}]},
  ];
  for(const options of cases){
    const m=fake(options);
    await assert.rejects(commitCdcMetadata(async()=>m.conn,plan()),
      /CDC_META_WRITE_UNAVAILABLE_OR_UNCERTAIN/);
    assert.equal(m.sqls.at(-1),CDC_METADATA_SQL.ROLLBACK);
    assert.equal(m.ended(),1);
    assert(!m.sqls.includes(CDC_METADATA_SQL.COMMIT));
  }
});

test("failed feed or checkpoint CAS rolls back transaction",async()=>{
  for(const sql of [CDC_METADATA_SQL.BUMP,CDC_METADATA_SQL.CHECKPOINT]){
    const m=fake({affected:{[sql]:0}});
    await assert.rejects(commitCdcMetadata(async()=>m.conn,plan()),
      /CDC_META_WRITE_UNAVAILABLE_OR_UNCERTAIN/);
    assert.equal(m.sqls.at(-1),CDC_METADATA_SQL.ROLLBACK);
    assert(!m.sqls.includes(CDC_METADATA_SQL.COMMIT));
    assert.equal(m.ended(),1);
  }
});

test("driver, commit and rollback failures are redacted; do not report success",async()=>{
  for(const sql of [CDC_METADATA_SQL.INSERT,CDC_METADATA_SQL.COMMIT]){
    const m=fake({fail:sql});
    await assert.rejects(commitCdcMetadata(async()=>m.conn,plan()),
      error=>error instanceof Error &&
        error.message==="CDC_META_WRITE_UNAVAILABLE_OR_UNCERTAIN");
    assert.equal(m.ended(),1);
  }
});

test("reader and writer use same canonical metadata checkpoint and feed table",()=>{
  assert(CDC_METADATA_SQL.LOCK.includes("fixer_cdc_meta.cdc_checkpoint"));
  assert(CDC_METADATA_SQL.BUMP.includes("fixer_cdc_meta.cdc_feed_generation"));
  assert(CDC_METADATA_SQL.CHECKPOINT.includes("fence_epoch=?"));
  assert(CDC_METADATA_SQL.FIND.includes("fixer_cdc_meta.cdc_commit_digest"));
});
