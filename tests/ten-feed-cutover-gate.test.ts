import assert from "node:assert/strict";
import {LOAD_ORDER} from "../src/services/reportFormats.js";
import {evaluateTenFeedCutover} from "../src/services/tenFeedCutoverGate.js";
const now=new Date("2026-10-16T16:45:00Z"),d="a".repeat(64);
const valid={candidateGeneration:"candidate_1",activeGeneration:"active_1",
 proofs:LOAD_ORDER.map(feed=>({feed,sourceRows:10,stagedRows:10,matchedRows:10,
  sourceDigest:d,stagedDigest:d,watermark:"2026-10-16T16:40:00Z"})),
 mappingReviewed:true,readOnlyCredentialsVerified:true,sourceSnapshotImmutableOrReplaySafe:true,
 cloudObjectReadbackVerified:true,cloudCheckpointsFenced:true,recoveryDrillPassed:true,
 rollbackDrillPassed:true,semanticParityVerified:true,tenantIsolationVerified:true,
 securityApproved:true,operatorApproved:true,
 sourceBytesTransferred:1000,maximumSourceBytes:2000,projectedNeonWriteBytes:500,
 maximumNeonWriteBytes:1000,projectedNeonResidentBytes:100,
 maximumNeonResidentBytes:500,checkedAt:"2026-10-16T16:44:00Z"};
const ready=evaluateTenFeedCutover(valid,now);
assert.equal(ready.readyForProduction,true,ready.blockers.join("; "));
assert.equal(ready.cutoverExecuted,false);
assert.equal(ready.productionDataModified,false);
const blocked=evaluateTenFeedCutover({...valid,recoveryDrillPassed:false,cloudObjectReadbackVerified:false},now);
assert.equal(blocked.readyForProduction,false);
assert(blocked.blockers.some(x=>x.includes("recovery")));
assert(blocked.blockers.some(x=>x.includes("cloud readback")));
assert.equal(evaluateTenFeedCutover({...valid,proofs:valid.proofs.slice(1)},now).readyForProduction,false);
assert.equal(evaluateTenFeedCutover({...valid,proofs:valid.proofs.map((p,i)=>i===0?{...p,sourceDigest:"b".repeat(64)}:p)},now).readyForProduction,false);
assert.equal(evaluateTenFeedCutover({...valid,sourceBytesTransferred:2001},now).readyForProduction,false);
assert.equal(evaluateTenFeedCutover({...valid,checkedAt:"2026-10-15T16:44:00Z"},now).readyForProduction,false);
assert.equal(evaluateTenFeedCutover({...valid,activeGeneration:"candidate_1"},now).readyForProduction,false);
assert.equal(evaluateTenFeedCutover({...valid,proofs:valid.proofs.map((p,i)=>i===0?{...p,matchedRows:9}:p)},now).readyForProduction,false);
console.log("Ten-feed release gate refuses missing recovery, stale evidence, and unbounded source migrations");
