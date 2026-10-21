import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { measureSemanticNotificationDelivery } from "../src/services/semanticNotificationDelivery.js";

const channel="newchanges_semantic_testing_probe";
const marker="12345678-1234-4123-8123-123456789abc";
const receiver=new EventEmitter();
const observed=await measureSemanticNotificationDelivery({
  receiver,channel,payload:marker,timeoutMs:200,
  publish:async()=>{
    receiver.emit("notification",{channel:"unrelated_channel",payload:marker});
    receiver.emit("notification",{channel,payload:"ffffffff-ffff-4fff-8fff-ffffffffffff"});
    setImmediate(()=>receiver.emit("notification",{channel,payload:marker}));
  },
});
assert(Number.isFinite(observed)&&observed>=0);
assert.equal(receiver.listenerCount("notification"),0,"Successful notification must release listener");

await assert.rejects(measureSemanticNotificationDelivery({
  receiver,channel,payload:marker,timeoutMs:100,
  publish:async()=>{},
}),/notification delivery timeout/);
assert.equal(receiver.listenerCount("notification"),0,"Timed-out listener must be removed");

await assert.rejects(measureSemanticNotificationDelivery({
  receiver,channel,payload:marker,timeoutMs:100,
  publish:async()=>{throw new Error("diagnostic publisher refused");},
}),/diagnostic publisher refused/);
assert.equal(receiver.listenerCount("notification"),0,"Publisher failure must release listener");

for(const invalid of [
  {channel:"not valid",payload:marker,timeoutMs:100},
  {channel,payload:"not-a-guid",timeoutMs:100},
  {channel,payload:marker,timeoutMs:60_000},
]){
  await assert.rejects(measureSemanticNotificationDelivery({
    receiver,...invalid,publish:async()=>{},
  }),/Invalid semantic notification probe parameters/);
}
assert.equal(receiver.listenerCount("notification"),0);
console.log("Isolated PostgreSQL notification delivery contract, timeout and cleanup passed offline");
