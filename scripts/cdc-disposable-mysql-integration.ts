/**
 * EXPLICIT, DISPOSABLE Docker-only integration exercise. NEVER run against RDS.
 * Tests real InnoDB commit/rollback/replay semantics, shared reader and
 * notification relay. This does NOT generate or consume actual binlog events:
 * the test passes a synthetic verified-XID intent to the offline writer.
 */
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import {LOAD_ORDER} from "../src/services/reportFormats.js";
import {planCommittedCdcWrite} from "../src/services/mysqlCdcCommitPlan.js";
import {commitCdcMetadata} from "../src/services/mysqlCdcMetadataWriter.js";
import {readCommittedFeedSnapshot} from "../src/services/mysqlSharedGenerationReader.js";
import {createCommittedFeedSnapshotRelay} from "../src/services/mysqlCommittedFeedRelay.js";
import {createChartInvalidationHub} from "../src/services/mysqlChartInvalidationHub.js";

const flag=process.env.FIXER_CDC_DISPOSABLE_MYSQL_TEST==="I_ACCEPT_LOCAL_CONTAINER_ONLY";
const host=process.env.FIXER_CDC_TEST_HOST;
const port=Number(process.env.FIXER_CDC_TEST_PORT);
const containerName=process.env.FIXER_CDC_TEST_CONTAINER;
if(!flag || host!=="127.0.0.1" || !Number.isSafeInteger(port) ||
   port<1024 || port>65535 || !/^fixer-cdc-test-[a-z0-9]{8,32}$/.test(containerName??""))
  throw Error("CDC_LOCAL_TEST_DISABLED_OR_UNTRUSTED_TARGET");

const config={
  host,port,user:"root",password:process.env.FIXER_CDC_TEST_PASSWORD??"",
  multipleStatements:false,bigNumberStrings:true,supportBigNumbers:true,
  connectTimeout:5000,
};
if(!config.password)throw Error("CDC_LOCAL_TEST_PASSWORD_REQUIRED");
const source="source_test";
const metadataConnector=async()=>{
  const db=await mysql.createConnection(config);
  return {query:(command:{sql:string;timeout:number},params:unknown[])=>
    db.query({sql:command.sql,timeout:command.timeout},params),
    end:()=>db.end()};
};

async function run(){
  const admin=await mysql.createConnection(config);
  try{
    // Docker-created isolated instance only, identified by explicit caller.
    // Never DROP a database, schema, or persistent customer object.
    await admin.query("CREATE DATABASE fixer_cdc_meta");
    await admin.query(`CREATE TABLE fixer_cdc_meta.cdc_checkpoint (
      source_id VARCHAR(100) PRIMARY KEY,
      binlog_file VARCHAR(128) NOT NULL,
      binlog_position BIGINT UNSIGNED NOT NULL,
      generation BIGINT UNSIGNED NOT NULL,
      fence_epoch BIGINT UNSIGNED NOT NULL,
      updated_at_utc DATETIME(6) NOT NULL
    ) ENGINE=InnoDB`);
    await admin.query(`CREATE TABLE fixer_cdc_meta.cdc_feed_generation (
      source_id VARCHAR(100) NOT NULL,
      feed VARCHAR(64) NOT NULL,
      generation BIGINT UNSIGNED NOT NULL,
      PRIMARY KEY(source_id,feed),
      FOREIGN KEY (source_id) REFERENCES fixer_cdc_meta.cdc_checkpoint(source_id)
    ) ENGINE=InnoDB`);
    await admin.query(`CREATE TABLE fixer_cdc_meta.cdc_commit_digest (
      source_id VARCHAR(100) NOT NULL,
      binlog_file VARCHAR(128) NOT NULL,
      binlog_position BIGINT UNSIGNED NOT NULL,
      digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      PRIMARY KEY(source_id,binlog_file,binlog_position),
      FOREIGN KEY (source_id) REFERENCES fixer_cdc_meta.cdc_checkpoint(source_id)
    ) ENGINE=InnoDB`);
    await admin.execute("INSERT INTO fixer_cdc_meta.cdc_checkpoint VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(6))",
      [source,"mysql-bin.000001",4,0,8]);
    for(const feed of LOAD_ORDER)
      await admin.execute("INSERT INTO fixer_cdc_meta.cdc_feed_generation VALUES (?,?,0)",[source,feed]);

    const initial=await readCommittedFeedSnapshot(metadataConnector,source);
    assert.equal(initial.checkpointGeneration,0);
    assert(Object.values(initial.feeds).every(v=>v===0));

    const hub=createChartInvalidationHub();
    const seenA:unknown[]=[],seenB:unknown[]=[],seenOther:unknown[]=[];
    const unsubs=[
      hub.subscribe({sourceId:source,tenantId:"tenantA",employerRef:"EMP_A",
        authorizedEmployerRefs:["EMP_A"]},event=>seenA.push(event)),
      hub.subscribe({sourceId:source,tenantId:"tenantB",employerRef:"EMP_B",
        authorizedEmployerRefs:["EMP_B"]},event=>seenB.push(event)),
      hub.subscribe({sourceId:"different_source",tenantId:"tenantA",employerRef:"EMP_A",
        authorizedEmployerRefs:["EMP_A"]},event=>seenOther.push(event)),
    ];
    const relay=createCommittedFeedSnapshotRelay({
      approvedSourceId:source,
      read:()=>readCommittedFeedSnapshot(metadataConnector,source),
      publish:hub,
    });
    assert.equal(await relay.poll(),0);
    const plan=planCommittedCdcWrite({
      sourceId:source,binlogFile:"mysql-bin.000001",binlogPosition:100,
      expectedGeneration:0,affectedFeeds:["journeys"],
      commitDigest:"a".repeat(64),xidVerified:true,leaderEpoch:8,
    });
    assert.equal(await commitCdcMetadata(metadataConnector,plan),"COMMITTED");
    assert.equal(await relay.poll(),2);
    assert.deepEqual(seenA,[{type:"MYSQL_CHART_INVALIDATION",feed:"journeys",generation:1}]);
    assert.deepEqual(seenB,seenA);
    assert.deepEqual(seenOther,[]);
    assert.equal(await commitCdcMetadata(metadataConnector,plan),"REPLAYED");
    assert.equal(await relay.poll(),0);

    // Conflict must roll back without advancing generation.
    await assert.rejects(commitCdcMetadata(metadataConnector,{
      ...plan,commitDigest:"b".repeat(64),
    }),/CDC_META_WRITE_UNAVAILABLE_OR_UNCERTAIN/);
    let current=await readCommittedFeedSnapshot(metadataConnector,source);
    assert.equal(current.checkpointGeneration,1);
    assert.equal(current.feeds.journeys,1);

    // Simulated second, distinct verified source commit.
    const second=planCommittedCdcWrite({
      sourceId:source,binlogFile:"mysql-bin.000001",binlogPosition:200,
      expectedGeneration:1,affectedFeeds:["employees","journeys"],
      commitDigest:"c".repeat(64),xidVerified:true,leaderEpoch:8,
    });
    assert.equal(await commitCdcMetadata(metadataConnector,second),"COMMITTED");
    assert.equal(await relay.poll(),4);
    current=await readCommittedFeedSnapshot(metadataConnector,source);
    assert.equal(current.checkpointGeneration,2);
    assert.equal(current.feeds.journeys,2);
    assert.equal(current.feeds.employees,1);
    assert.equal(seenA.length,3);

    // Takeover increments the DB fence; old worker can no longer commit.
    await admin.execute("UPDATE fixer_cdc_meta.cdc_checkpoint SET fence_epoch=9 WHERE source_id=?",[source]);
    const stale=planCommittedCdcWrite({
      sourceId:source,binlogFile:"mysql-bin.000001",binlogPosition:300,
      expectedGeneration:2,affectedFeeds:["ratings"],
      commitDigest:"d".repeat(64),xidVerified:true,leaderEpoch:8,
    });
    await assert.rejects(commitCdcMetadata(metadataConnector,stale),
      /CDC_META_WRITE_UNAVAILABLE_OR_UNCERTAIN/);
    current=await readCommittedFeedSnapshot(metadataConnector,source);
    assert.equal(current.checkpointGeneration,2);
    assert.equal(current.feeds.ratings,0);
    assert.deepEqual(seenOther,[]);
    unsubs.forEach(fn=>fn?.());
    process.stdout.write("PASS: isolated Docker MySQL InnoDB commit, replay, conflict, fencing, durable reads and scoped SSE fanout contract.\n");
    process.stdout.write("NOT TESTED: live AWS replication, actual XID parsing, customer data, browser session or production leader election.\n");
  }finally{await admin.end();}
}
await run();
