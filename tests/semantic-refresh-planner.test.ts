import { partitionsFromCanonicalSourceRows, mergeAndExpandSemanticPartitions } from "../src/services/semanticSourceChangePlanner.js";
import { expandHistoricalRefresh } from "../src/services/semanticHistoricalDependencies.js";
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
assert.deepEqual(expandHistoricalRefresh([{employerId:"a",period:"2026-08",feeds:["employees"],deleted:true}],"2026-10"), [
  {employerId:"a",period:"2026-08",feeds:["employees"],deleted:true},
  {employerId:"a",period:"2026-09",feeds:["employees"],deleted:true},
  {employerId:"a",period:"2026-10",feeds:["employees"],deleted:true},
]);
assert.throws(()=>expandHistoricalRefresh([{employerId:"a",period:"2026-01",feeds:["policies"],deleted:false}],"2026-10",3),/budget exceeded/);

// Transport updates in October can correct a March business observation.
const datedCorrection = partitionsFromCanonicalSourceRows("employees",[{
  employer_ref:"VIG",observed_at:"2026-03-31",eligible_from:"2026-02-01",
  source_updated_at:"2026-10-14T11:00:00Z",is_deleted:true,
}]);
assert.deepEqual(datedCorrection,[{employerId:"VIG",period:"2026-02",feeds:["employees"],deleted:true}]);
const historical = mergeAndExpandSemanticPartitions([
  ...datedCorrection,
  ...partitionsFromCanonicalSourceRows("policies",[{
    employer_ref:"VIG",observed_at:"2026-05-31",
    source_updated_at:"2026-10-14T11:00:00Z",
  }]),
],"2026-10");
assert.equal(historical.length,9);
assert.deepEqual(historical[0],{employerId:"VIG",period:"2026-02",feeds:["employees"],deleted:true});
assert.deepEqual(historical.find(x=>x.period==="2026-05")?.feeds,["employees","policies"]);
assert.throws(()=>mergeAndExpandSemanticPartitions(datedCorrection,"2026-10",3),/budget exceeded/);
assert.throws(()=>partitionsFromCanonicalSourceRows("ratings",[{employer_ref:"VIG",created_at:"invalid"}]),/Invalid business date/);

console.log("Incremental semantic partition planner tests passed");
