import assert from "node:assert/strict";
import {assessReplacementEvidence,REPLACEMENT_REQUIREMENTS} from "../src/services/datasetReplacementApproval.js";
const empty=assessReplacementEvidence({});
assert.equal(empty.readyForOperatorReview,false);
assert.equal(empty.executionEnabled,false);
assert.equal(empty.missing.length,REPLACEMENT_REQUIREMENTS.length);
for(const key of REPLACEMENT_REQUIREMENTS){
  const partial=Object.fromEntries(REPLACEMENT_REQUIREMENTS.filter(x=>x!==key).map(x=>[x,true]));
  assert(empty.missing.includes(key));
  assert.equal(assessReplacementEvidence(partial).readyForOperatorReview,false,key);
}
const reviewed=assessReplacementEvidence(Object.fromEntries(REPLACEMENT_REQUIREMENTS.map(key=>[key,true])));
assert.equal(reviewed.readyForOperatorReview,true);
assert.equal(reviewed.executionEnabled,false);
console.log("Dataset replacement safety approval gates passed");
