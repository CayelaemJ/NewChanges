import assert from "node:assert/strict";
import {test} from "node:test";
import {LOAD_ORDER} from "../src/services/reportFormats.js";
import {createChartInvalidationHub} from "../src/services/mysqlChartInvalidationHub.js";
import {createRailwayCdcObserver,railwayCdcObserverConfig} from "../src/services/railwayCdcGenerationObserver.js";
import type {DurableFeedGenerations} from "../src/services/mysqlCommittedFeedGenerations.js";

const env=()=>({
  FIXER_CDC_SHARED_OBSERVER_ENABLED:"true",
  RAILWAY_PROJECT_ID:"f2f1bc4f-5de8-436e-9414-5dc125650e96",
  RAILWAY_ENVIRONMENT_ID:"9ff830b6-24c3-4319-bee1-82b6a74db270",
  FIXER_CDC_SHARED_SOURCE_ID:"synthetic_source",
  FIXER_CDC_SHARED_HOST:"mysql-test.internal",
  FIXER_CDC_SHARED_PORT:"3306",
  FIXER_CDC_SHARED_READ_USER:"read_only",
  FIXER_CDC_SHARED_READ_PASSWORD:"test-only",
  FIXER_CDC_SHARED_CA_PEM:"-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----",
  FIXER_CDC_SHARED_INTERVAL_MS:"3000",
});

test("CDC observer is completely disabled unless opted in",()=>{
  assert.equal(railwayCdcObserverConfig({}),null);
  assert.equal(railwayCdcObserverConfig({FIXER_CDC_SHARED_OBSERVER_ENABLED:"false"}),null);
  assert.throws(()=>railwayCdcObserverConfig({...env(),RAILWAY_PROJECT_ID:"production"}),/STAGING_ONLY/);
  assert.throws(()=>railwayCdcObserverConfig({...env(),RAILWAY_ENVIRONMENT_ID:"production"}),/STAGING_ONLY/);
  assert.throws(()=>railwayCdcObserverConfig({...env(),FIXER_CDC_SHARED_CA_PEM:""}),/CONFIG_INVALID/);
});
test("read-only observed generations fan out only to authorized live SSE subscribers",async()=>{
  const config=railwayCdcObserverConfig(env());
  assert(config);
  const hub=createChartInvalidationHub();
  const first:unknown[]=[],other:unknown[]=[];
  hub.subscribe({sourceId:config.sourceId,tenantId:"portal",employerRef:"EMP_ONE",
    authorizedEmployerRefs:["EMP_ONE"]},x=>first.push(x));
  hub.subscribe({sourceId:"another_source",tenantId:"portal",employerRef:"EMP_ONE",
    authorizedEmployerRefs:["EMP_ONE"]},x=>other.push(x));
  let count=0;
  const snapshot=(generation:number):DurableFeedGenerations=>({
    sourceId:config.sourceId,checkpointGeneration:generation,
    feeds:Object.fromEntries(LOAD_ORDER.map(feed=>[feed,feed==="journeys"?generation:0])),
  });
  const observer=createRailwayCdcObserver(config,hub,{
    read:async()=>snapshot(count),
  });
  assert.equal(await observer.poll(),0);
  count=1;
  assert.equal(await observer.poll(),1);
  assert.equal(await observer.poll(),0);
  assert.deepEqual(first,[{type:"MYSQL_CHART_INVALIDATION",feed:"journeys",generation:1}]);
  assert.deepEqual(other,[]);
  assert.equal(observer.status().failures,0);
  observer.stop();
  assert.equal(await observer.poll(),0);
});
