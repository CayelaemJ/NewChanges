import assert from "node:assert/strict";
import {
  SEMANTIC_QUEUE_WAKE_CHANNEL,semanticQueueWakeEnabled,
  semanticListenerEnabled,shouldWakeSemanticWorker,
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
console.log("Optional semantic queue wake, idempotent trigger and dedicated worker gates passed");
