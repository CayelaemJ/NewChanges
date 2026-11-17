import assert from "node:assert/strict";
import {test} from "node:test";
import {LOAD_ORDER} from "../src/services/reportFormats.js";
import {createChartInvalidationHub} from "../src/services/mysqlChartInvalidationHub.js";
import {createCommittedFeedSnapshotRelay} from "../src/services/mysqlCommittedFeedRelay.js";
import type {DurableFeedGenerations} from "../src/services/mysqlCommittedFeedGenerations.js";

const snapshot=(checkpointGeneration:number,journeys:number,sourceId="rds_one"):DurableFeedGenerations=>({
  sourceId,checkpointGeneration,
  feeds:Object.fromEntries(LOAD_ORDER.map(k=>[k,k==="journeys"?journeys:0])),
});
const scope=(sourceId:string,tenantId:string,employerRef:string)=>({
  sourceId,tenantId,employerRef,authorizedEmployerRefs:[employerRef],
});

test("durable feed generations fan out to all authorized employers on same source, not others",async()=>{
  const hub=createChartInvalidationHub();
  const first:unknown[]=[],second:unknown[]=[],unrelated:unknown[]=[];
  hub.subscribe(scope("rds_one","tenantA","EMP_ONE"),ev=>first.push(ev));
  hub.subscribe(scope("rds_one","tenantB","EMP_TWO"),ev=>second.push(ev));
  hub.subscribe(scope("rds_other","tenantA","EMP_ONE"),ev=>unrelated.push(ev));
  let current=snapshot(0,0);
  const relay=createCommittedFeedSnapshotRelay({
    approvedSourceId:"rds_one",read:async()=>current,publish:hub,
  });
  assert.equal(await relay.poll(),0); // Initial baseline cannot fabricate changes.
  current=snapshot(1,1);
  assert.equal(await relay.poll(),2);
  assert.deepEqual(first,[{type:"MYSQL_CHART_INVALIDATION",feed:"journeys",generation:1}]);
  assert.deepEqual(second,first);
  assert.deepEqual(unrelated,[]);
  assert(!JSON.stringify(first).includes("EMP_ONE"));
  assert(!JSON.stringify(first).includes("tenantA"));
  assert.equal(await relay.poll(),0);
});

test("checkpoint or feed regression fails closed; no subscriber notified",async()=>{
  const hub=createChartInvalidationHub();
  const changes:unknown[]=[];
  hub.subscribe(scope("rds_one","tenantA","EMP"),ev=>changes.push(ev));
  let current=snapshot(2,2);
  const relay=createCommittedFeedSnapshotRelay({
    approvedSourceId:"rds_one",read:async()=>current,publish:hub,
  });
  await relay.poll();
  current=snapshot(1,1);
  await assert.rejects(relay.poll(),/REGRESSION/);
  assert.equal(changes.length,0);
});

test("source switches and reader failures are redacted and do not advance baseline",async()=>{
  const hub=createChartInvalidationHub();
  let current=snapshot(0,0);
  let failing=false;
  const relay=createCommittedFeedSnapshotRelay({
    approvedSourceId:"rds_one",
    read:async()=>{if(failing)throw Error("SECRET_SQL_CREDENTIAL");return current;},
    publish:hub,
  });
  await relay.poll();
  failing=true;
  await assert.rejects(relay.poll(),error=>
    error instanceof Error && error.message==="CDC_SNAPSHOT_RELAY_READ_FAILED");
  failing=false;
  current=snapshot(1,1,"rds_other");
  await assert.rejects(relay.poll(),/SOURCE_MISMATCH/);
});

test("failed publish retries from earlier snapshot, hub deduplicates notified generations",async()=>{
  const hub=createChartInvalidationHub();
  let current=snapshot(0,0);
  let fail=true;
  let attempts=0;
  const relay=createCommittedFeedSnapshotRelay({
    approvedSourceId:"rds_one",read:async()=>current,
    publish:{notifyFeed(sourceId,event){
      attempts++;
      if(fail)throw Error("SECRET_TRANSPORT_EXCEPTION");
      return hub.notifyFeed(sourceId,event);
    }},
  });
  await relay.poll();
  current=snapshot(1,1);
  await assert.rejects(relay.poll(),error=>
    error instanceof Error && error.message==="CDC_SNAPSHOT_RELAY_PUBLICATION_FAILED");
  fail=false;
  assert.equal(await relay.poll(),0); // No subscriber exists yet.
  assert.equal(attempts,2);
});

test("concurrent polls share one committed store read",async()=>{
  const hub=createChartInvalidationHub();
  let reads=0;
  const relay=createCommittedFeedSnapshotRelay({
    approvedSourceId:"rds_one",
    read:async()=>{reads++;await new Promise(resolve=>setTimeout(resolve,1));return snapshot(0,0);},
    publish:hub,
  });
  await Promise.all([relay.poll(),relay.poll(),relay.poll()]);
  assert.equal(reads,1);
});

test("feed notice rejects untrusted envelopes and stops after unsubscribe",()=>{
  const hub=createChartInvalidationHub();
  const seen:unknown[]=[];
  const dispose=hub.subscribe(scope("rds_one","tenantA","EMP"),ev=>seen.push(ev));
  assert(dispose);
  assert.throws(()=>hub.notifyFeed("rds_one",{type:"MYSQL_FEED_INVALIDATION",feed:"bad",generation:1}),
    /CDC_CHART_FEED_EVENT_INVALID/);
  assert.equal(hub.notifyFeed("rds_one",{type:"MYSQL_FEED_INVALIDATION",feed:"journeys",generation:1}),1);
  assert.equal(hub.notifyFeed("rds_one",{type:"MYSQL_FEED_INVALIDATION",feed:"journeys",generation:1}),0);
  dispose();
  assert.equal(hub.notifyFeed("rds_one",{type:"MYSQL_FEED_INVALIDATION",feed:"journeys",generation:2}),0);
  assert.equal(seen.length,1);
});
