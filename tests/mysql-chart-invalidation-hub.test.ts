import assert from "node:assert/strict";
import {test} from "node:test";
import {createChartInvalidationHub} from "../src/services/mysqlChartInvalidationHub.js";

const scope={sourceId:"reporting_rds",tenantId:"tenantA",
  employerRef:"VIG",authorizedEmployerRefs:["VIG"]};
const event={sourceId:"reporting_rds",tenantId:"tenantA",
  employerRef:"VIG",feed:"journeys",generation:1,committed:true as const};

test("committed change notifies only matching authorized source, tenant and employer",()=>{
  const hub=createChartInvalidationHub();
  const received:unknown[]=[];
  hub.subscribe(scope,change=>received.push(change));
  const other:unknown[]=[];
  hub.subscribe({...scope,tenantId:"tenantB"},change=>other.push(change));
  hub.subscribe({...scope,employerRef:"OTHER",authorizedEmployerRefs:["OTHER"]},
    change=>other.push(change));
  assert.equal(hub.notify(event),1);
  assert.deepEqual(received,[{type:"MYSQL_CHART_INVALIDATION",feed:"journeys",generation:1}]);
  assert.equal(other.length,0);
  assert(!JSON.stringify(received).includes("VIG"));
  assert(!JSON.stringify(received).includes("tenantA"));
});

test("duplicate and reordered generations never re-notify, per-feed scope isolated",()=>{
  const hub=createChartInvalidationHub();
  const seen:unknown[]=[];
  hub.subscribe(scope,v=>seen.push(v));
  assert.equal(hub.notify({...event,generation:5}),1);
  assert.equal(hub.notify({...event,generation:5}),0);
  assert.equal(hub.notify({...event,generation:4}),0);
  assert.equal(hub.notify({...event,feed:"employees",generation:1}),1);
  assert.equal(seen.length,2);
});

test("uncommitted, unknown feed, malformed generations and unauthorized subscribers rejected",()=>{
  const hub=createChartInvalidationHub();
  for(const change of [
    {...event,committed:false},
    {...event,feed:"mysql.user"},
    {...event,generation:-1},
    {...event,generation:NaN},
  ]) assert.throws(()=>hub.notify(change as typeof event),/CDC_CHART_UNVERIFIED_CHANGE/);
  assert.throws(()=>hub.subscribe({...scope,authorizedEmployerRefs:["OTHER"]},()=>{}),
    /CDC_CHART_SUBSCRIBER_UNAUTHORIZED/);
  assert.throws(()=>hub.subscribe({...scope,tenantId:"../OTHER"},()=>{}),
    /CDC_CHART_SCOPE_INVALID/);
});

test("unsubscribe stops notifications and clears obsolete local generations",()=>{
  const hub=createChartInvalidationHub();
  const seen:unknown[]=[];
  const dispose=hub.subscribe(scope,v=>seen.push(v));
  assert(dispose);
  hub.notify({...event,generation:3});
  dispose();
  dispose();
  assert.equal(hub.notify({...event,generation:4}),0);
  assert.equal(seen.length,1);
  hub.subscribe(scope,v=>seen.push(v));
  assert.equal(hub.notify({...event,generation:1}),1);
});

test("failing listener does not block another subscriber",()=>{
  const hub=createChartInvalidationHub();
  hub.subscribe(scope,()=>{throw Error("SECRET_HANDLER_ERROR");});
  let count=0;
  hub.subscribe(scope,()=>count++);
  assert.equal(hub.notify(event),2);
  assert.equal(count,1);
});

test("process-local subscriber capacity is bounded",()=>{
  const hub=createChartInvalidationHub();
  for(let i=0;i<16;i++)assert(hub.subscribe(scope,()=>{}));
  assert.equal(hub.subscribe(scope,()=>{}),null);
});
