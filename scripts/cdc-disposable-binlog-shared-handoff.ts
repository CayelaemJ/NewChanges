/**
 * Explicit LOCAL-DOCKER-only handoff from Python's observed ROW/FULL XIDs to
 * the real InnoDB metadata writer + reader + notification relay.
 *
 * Python sends only bounded source/coordinate/feed/digest metadata over stdin.
 * No raw source rows, API routes, AWS credentials or production activation.
 */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import mysql from "mysql2/promise";
import {LOAD_ORDER} from "../src/services/reportFormats.js";
import {planCommittedCdcWrite} from "../src/services/mysqlCdcCommitPlan.js";
import {commitCdcMetadata} from "../src/services/mysqlCdcMetadataWriter.js";
import {readCommittedFeedSnapshot} from "../src/services/mysqlSharedGenerationReader.js";
import {createCommittedFeedSnapshotRelay} from "../src/services/mysqlCommittedFeedRelay.js";
import {createChartInvalidationHub} from "../src/services/mysqlChartInvalidationHub.js";

const name=process.env.FIXER_CDC_TEST_CONTAINER??"";
const port=Number(process.env.FIXER_CDC_TEST_PORT);
const password=process.env.FIXER_CDC_TEST_PASSWORD??"";
if(process.env.FIXER_CDC_DISPOSABLE_MYSQL_TEST!=="I_ACCEPT_LOCAL_CONTAINER_ONLY" ||
   process.env.FIXER_CDC_TEST_HOST!=="127.0.0.1" ||
   !/^fixer-cdc-test-[0-9a-f]{16,64}$/.test(name) ||
   !Number.isSafeInteger(port) || port<1024 || port>65535 ||
   !/^local-only-[0-9a-f]{32}$/.test(password))
  throw Error("CDC_HANDOFF_LOCAL_DOCKER_ONLY");

type Observed={file:string;position:number;feed:string;operation:string;digest:string};
type Envelope={sourceId:string;file:string;position:number;observed:Observed[]};
const inputChunks:Buffer[]=[];
for await(const chunk of process.stdin){
  inputChunks.push(Buffer.from(chunk));
  if(inputChunks.reduce((n,b)=>n+b.length,0)>8192)
    throw Error("CDC_HANDOFF_METADATA_BUDGET_EXCEEDED");
}
let envelope:Envelope;
try{envelope=JSON.parse(Buffer.concat(inputChunks).toString("utf8")) as Envelope;}
catch{throw Error("CDC_HANDOFF_INVALID_JSON");}
const filePattern=/^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
if(!envelope || envelope.sourceId!=="disposable_local_source" ||
   !filePattern.test(envelope.file) ||
   !Number.isSafeInteger(envelope.position) || envelope.position<4 ||
   !Array.isArray(envelope.observed) || envelope.observed.length!==3)
  throw Error("CDC_HANDOFF_INVALID_BASELINE");
const operations=["WRITE_ROWS","UPDATE_ROWS","DELETE_ROWS"];
let last=envelope.position;
for(let index=0;index<3;index++){
  const ev=envelope.observed[index];
  if(!ev || ev.file!==envelope.file || ev.feed!=="journeys" ||
     ev.operation!==operations[index] ||
     !Number.isSafeInteger(ev.position) || ev.position<=last ||
     !/^[0-9a-f]{64}$/.test(ev.digest))
    throw Error("CDC_HANDOFF_INVALID_COMMIT");
  last=ev.position;
}
const config={host:"127.0.0.1",port,user:"root",password,
  multipleStatements:false,bigNumberStrings:true,supportBigNumbers:true,
  connectTimeout:5000};
const connector=async()=>{
  const db=await mysql.createConnection(config);
  return {query:(command:{sql:string;timeout:number},params:unknown[])=>
    db.query({sql:command.sql,timeout:command.timeout},params),
    end:()=>db.end()};
};
const admin=await mysql.createConnection(config);
try{
  // Single-use database in an ephemeral container only. No DROP or ALTER.
  await admin.query("CREATE DATABASE fixer_cdc_meta");
  await admin.query(`CREATE TABLE fixer_cdc_meta.cdc_checkpoint (
    source_id VARCHAR(100) PRIMARY KEY, binlog_file VARCHAR(128) NOT NULL,
    binlog_position BIGINT UNSIGNED NOT NULL, generation BIGINT UNSIGNED NOT NULL,
    fence_epoch BIGINT UNSIGNED NOT NULL, updated_at_utc DATETIME(6) NOT NULL
  ) ENGINE=InnoDB`);
  await admin.query(`CREATE TABLE fixer_cdc_meta.cdc_feed_generation (
    source_id VARCHAR(100) NOT NULL, feed VARCHAR(64) NOT NULL,
    generation BIGINT UNSIGNED NOT NULL, PRIMARY KEY(source_id,feed),
    FOREIGN KEY(source_id) REFERENCES fixer_cdc_meta.cdc_checkpoint(source_id)
  ) ENGINE=InnoDB`);
  await admin.query(`CREATE TABLE fixer_cdc_meta.cdc_commit_digest (
    source_id VARCHAR(100) NOT NULL, binlog_file VARCHAR(128) NOT NULL,
    binlog_position BIGINT UNSIGNED NOT NULL,
    digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    PRIMARY KEY(source_id,binlog_file,binlog_position),
    FOREIGN KEY(source_id) REFERENCES fixer_cdc_meta.cdc_checkpoint(source_id)
  ) ENGINE=InnoDB`);
  await admin.execute(
    "INSERT INTO fixer_cdc_meta.cdc_checkpoint VALUES(?,?,?,?,?,UTC_TIMESTAMP(6))",
    [envelope.sourceId,envelope.file,envelope.position,0,8]);
  for(const feed of LOAD_ORDER)
    await admin.execute("INSERT INTO fixer_cdc_meta.cdc_feed_generation VALUES(?,?,0)",
      [envelope.sourceId,feed]);

  const hub=createChartInvalidationHub();
  const a:unknown[]=[],b:unknown[]=[],other:unknown[]=[];
  const unsubscribe=[
    hub.subscribe({sourceId:envelope.sourceId,tenantId:"tenantA",employerRef:"EMP_A",
      authorizedEmployerRefs:["EMP_A"]},event=>a.push(event)),
    hub.subscribe({sourceId:envelope.sourceId,tenantId:"tenantB",employerRef:"EMP_B",
      authorizedEmployerRefs:["EMP_B"]},event=>b.push(event)),
    hub.subscribe({sourceId:"unrelated_source",tenantId:"tenantA",employerRef:"EMP_A",
      authorizedEmployerRefs:["EMP_A"]},event=>other.push(event)),
  ];
  const relay=createCommittedFeedSnapshotRelay({
    approvedSourceId:envelope.sourceId,
    read:()=>readCommittedFeedSnapshot(connector,envelope.sourceId),
    publish:hub,
  });
  assert.equal(await relay.poll(),0);
  for(let index=0;index<3;index++){
    const ev=envelope.observed[index];
    // The source event type and XID were verified by the Python parser in
    // this test process. This is NOT an authentication protocol or production
    // attestation; it only demonstrates the local two-language handoff.
    const plan=planCommittedCdcWrite({
      sourceId:envelope.sourceId,binlogFile:ev.file,
      binlogPosition:ev.position,expectedGeneration:index,
      affectedFeeds:[ev.feed],commitDigest:ev.digest,
      xidVerified:true,leaderEpoch:8,
    });
    assert.equal(await commitCdcMetadata(connector,plan),"COMMITTED");
    assert.equal(await relay.poll(),2);
    assert.equal(await commitCdcMetadata(connector,plan),"REPLAYED");
    assert.equal(await relay.poll(),0);
  }
  const snapshot=await readCommittedFeedSnapshot(connector,envelope.sourceId);
  assert.equal(snapshot.checkpointGeneration,3);
  assert.equal(snapshot.feeds.journeys,3);
  assert(Object.entries(snapshot.feeds).every(([feed,n])=>
    feed==="journeys"?n===3:n===0));
  assert.deepEqual(a,[1,2,3].map(generation=>({
    type:"MYSQL_CHART_INVALIDATION",feed:"journeys",generation,
  })));
  assert.deepEqual(b,a);
  assert.deepEqual(other,[]);
  assert(!JSON.stringify(a).includes("EMP_A"));
  assert(!JSON.stringify(a).includes("tenantA"));
  unsubscribe.forEach(fn=>fn?.());

  // A divergent digest for an observed XID must never advance the cursor.
  const lastEvent=envelope.observed[2];
  await assert.rejects(commitCdcMetadata(connector,planCommittedCdcWrite({
    sourceId:envelope.sourceId,binlogFile:lastEvent.file,
    binlogPosition:lastEvent.position,expectedGeneration:2,
    affectedFeeds:["journeys"],
    commitDigest:createHash("sha256").update("conflicting-local-digest").digest("hex"),
    xidVerified:true,leaderEpoch:8,
  })),/CDC_META_WRITE_UNAVAILABLE_OR_UNCERTAIN/);
  assert.equal((await readCommittedFeedSnapshot(connector,envelope.sourceId))
    .checkpointGeneration,3);
  process.stdout.write(
    "PASS: real parsed MySQL XIDs advanced shared InnoDB checkpoints and all 3 journeys generations; relay delivered authorized feed invalidations.\n");
  process.stdout.write(
    "NOT TESTED: production attestation, AWS binlog reader, elected leader, cross-process SSE delivery or browser.\n");
}finally{await admin.end();}
