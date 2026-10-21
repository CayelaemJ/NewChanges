import assert from "node:assert/strict";
import {
  SEMANTIC_QUEUE_WAKE_CHANNEL,semanticQueueWakeEnabled,
  semanticListenerEnabled,shouldWakeSemanticWorker,semanticListenerConnectionString,
} from "../src/services/semanticQueueWake.js";

const base={
  ENABLE_SEMANTIC_SHADOW_ENQUEUE:"true",
  ENABLE_SEMANTIC_QUEUE_WAKE:"true",
  ENABLE_SEMANTIC_EVENT_WORKER:"true",
  ENABLE_SEMANTIC_SHADOW_WORKER:"true",
  ENABLE_SEMANTIC_RECOMPUTE:"true",
  ENABLE_SEMANTIC_OBJECT_PUBLISH:"true",
};
assert.equal(SEMANTIC_QUEUE_WAKE_CHANNEL,"newchanges_semantic_refresh_ready");
assert.equal(semanticQueueWakeEnabled({}),false,"Wake must default off");
assert.equal(semanticListenerEnabled({}),false,"Listener must default off");
assert.equal(semanticQueueWakeEnabled(base),true);
assert.equal(semanticListenerEnabled(base),true);
assert.equal(shouldWakeSemanticWorker(1,base),true);
assert.equal(shouldWakeSemanticWorker(0,base),false,"Empty queue should not send NOTIFY");
assert.equal(shouldWakeSemanticWorker(-1,base),false);
assert.equal(shouldWakeSemanticWorker(1,{...base,ENABLE_SEMANTIC_QUEUE_WAKE:"false"}),false);
assert.equal(semanticQueueWakeEnabled({...base,ENABLE_SEMANTIC_SHADOW_ENQUEUE:"false"}),false);
assert.equal(semanticQueueWakeEnabled({...base,STANDBY_MODE:"true"}),false);
assert.equal(semanticListenerEnabled({...base,STANDBY_MODE:"true"}),false);
for(const key of ["ENABLE_SEMANTIC_EVENT_WORKER","ENABLE_SEMANTIC_SHADOW_WORKER",
  "ENABLE_SEMANTIC_OBJECT_PUBLISH","ENABLE_SEMANTIC_RECOMPUTE"]) {
  assert.equal(semanticListenerEnabled({...base,[key]:"false"}),false,key+" must fail closed");
}

const pooled="postgresql://synthetic:x@ep-example-pooler.us-east-1.aws.neon.tech/newchanges_testing_20261017?sslmode=require";
const direct="postgresql://synthetic:x@ep-example.us-east-1.aws.neon.tech/newchanges_testing_20261017?sslmode=require";
const cfg={...base,DATABASE_URL:pooled,SEMANTIC_LISTEN_DATABASE_URL:direct};
assert.equal(semanticListenerConnectionString(cfg),direct);
assert.throws(()=>semanticListenerConnectionString({...cfg,SEMANTIC_LISTEN_DATABASE_URL:pooled}),
  /direct non-pooler connection/);
assert.throws(()=>semanticListenerConnectionString({...cfg,SEMANTIC_LISTEN_DATABASE_URL:undefined}),
  /separate direct PostgreSQL connection/);
assert.throws(()=>semanticListenerConnectionString({...cfg,SEMANTIC_LISTEN_DATABASE_URL:direct.replace("newchanges_testing_20261017","railway")}),
  /SAME Neon database/);
assert.throws(()=>semanticListenerConnectionString({...cfg,SEMANTIC_LISTEN_DATABASE_URL:direct.replace("ep-example.","ep-other.")}),
  /SAME Neon database/);
assert.throws(()=>semanticListenerConnectionString({...cfg,SEMANTIC_LISTEN_DATABASE_URL:direct.replace("sslmode=require","sslmode=disable")}),
  /SAME Neon database/);
assert.throws(()=>semanticListenerConnectionString({...cfg,ENABLE_SEMANTIC_EVENT_WORKER:"false"}),
  /disabled/);
console.log("Optional semantic queue wake, idempotent trigger and dedicated worker gates passed");
