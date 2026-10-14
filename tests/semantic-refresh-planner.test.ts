import assert from "node:assert/strict";
import { affectedSemanticPartitions } from "../src/services/semanticRefreshPlanner.js";

const input = [
 {feed:"employees", employerId:"a", observedAt:"2026-09-30T00:00:00Z"},
 {feed:"policies", employerId:"a", observedAt:"2026-09-12T00:00:00Z",isDeleted:true},
 {feed:"employees", employerId:"b", observedAt:"2026-10-01T00:00:00Z"},
];
assert.deepEqual(affectedSemanticPartitions(input), [
 {employerId:"a",period:"2026-09",feeds:["employees","policies"],deleted:true},
 {employerId:"b",period:"2026-10",feeds:["employees"],deleted:false},
]);
assert.throws(()=>affectedSemanticPartitions(input,1),/budget exceeded/);
assert.throws(()=>affectedSemanticPartitions([{feed:"unknown",employerId:"a",observedAt:"2026-09-12"}]),/Unrecognized/);
assert.throws(()=>affectedSemanticPartitions([{feed:"employees",employerId:"a"}]),/invalid change time/);
console.log("Incremental semantic partition planner tests passed");
